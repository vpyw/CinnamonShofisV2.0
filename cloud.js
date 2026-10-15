// Datos privados por usuario. Firestore escucha cambios y usa transacciones para stock y ventas.
import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot, runTransaction, writeBatch
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

export const configured = ['apiKey', 'authDomain', 'projectId', 'appId'].every(
  key => typeof firebaseConfig[key] === 'string' && firebaseConfig[key].length > 7 &&
    !/PEGA_AQUI|TU_PROYECTO/.test(firebaseConfig[key])
);
let auth;
let db;
let uid = null;

export function initAuth(callback, onError) {
  if (!configured) return;
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  onAuthStateChanged(auth, user => {
    uid = user?.uid ?? null;
    callback(user);
  }, onError);
}
export function register(email, password) { return createUserWithEmailAndPassword(auth, email, password); }
export function login(email, password) { return signInWithEmailAndPassword(auth, email, password); }
export function logout() { return signOut(auth); }
export function resetPassword(email) { return sendPasswordResetEmail(auth, email); }
const path = kind => collection(db, 'users', uid, kind);
const item = (kind, id) => doc(db, 'users', uid, kind, id);
const meta = () => item('meta', 'settings');
const check = () => { if (!uid || !navigator.onLine) throw new Error('OFFLINE'); };

export function subscribe(onData, onError) {
  const chunks = { products: null, orders: null, meta: null };
  const cached = { products: false, orders: false, meta: false };
  const emit = () => {
    if (Object.values(chunks).some(value => value === null)) return;
    onData({
      products: chunks.products,
      orders: chunks.orders,
      nextOrderNumber: chunks.meta?.nextOrderNumber || 1,
      fromCache: Object.values(cached).some(Boolean)
    });
  };
  const listen = (ref, key, decode) => onSnapshot(ref, { includeMetadataChanges: true }, snapshot => {
    chunks[key] = decode(snapshot);
    cached[key] = snapshot.metadata.fromCache;
    emit();
  }, onError);
  const unsubs = [
    listen(path('products'), 'products', snap => snap.docs.map(d => ({ ...d.data(), id: d.id }))),
    listen(path('orders'), 'orders', snap => snap.docs.map(d => ({ ...d.data(), id: d.id }))),
    listen(meta(), 'meta', snap => snap.exists() ? snap.data() : {})
  ];
  return () => unsubs.forEach(unsub => unsub());
}

export async function saveProduct(product, original) {
  check();
  const ref = item('products', product.id);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!original && snap.exists()) throw new Error('CONFLICT');
    if (original && (!snap.exists() || (snap.data().revision || 0) !== (original.revision || 0))) throw new Error('CONFLICT');
    tx.set(ref, {
      ...product,
      archived: original?.archived || false,
      revision: (snap.exists() ? (snap.data().revision || 0) : 0) + 1
    });
  });
}
export async function setMenu(id, checked) {
  check();
  const ref = item('products', id);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists() || snap.data().archived) throw new Error('CONFLICT');
    tx.update(ref, { inMenu: checked, revision: (snap.data().revision || 0) + 1 });
  });
}
export async function setArchive(id, archived) {
  check();
  const ref = item('products', id);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('CONFLICT');
    tx.update(ref, { archived, inMenu: false, revision: (snap.data().revision || 0) + 1 });
  });
}
export async function addOrder(input) {
  check();
  if (input.lines.length > 80) throw new Error('TOO_MANY_PRODUCTS');
  const metaRef = meta();
  const refs = input.lines.map(line => item('products', line.productId));
  return runTransaction(db, async tx => {
    // Todas las lecturas deben ir ANTES de las escrituras.
    const [metaSnap, ...productSnaps] = await Promise.all([tx.get(metaRef), ...refs.map(ref => tx.get(ref))]);
    let subtotalCents = 0;
    const lines = input.lines.map((line, i) => {
      const product = productSnaps[i].data();
      if (!product || product.archived || !product.inMenu || product.stock < line.quantity) throw new Error('NO_STOCK');
      if (product.priceCents !== line.unitPriceCents) throw new Error('PRICE_CHANGED');
      if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 9999999) throw new Error('INVALID_ORDER');
      subtotalCents += product.priceCents * line.quantity;
      return { productId: line.productId, name: product.name, unitPriceCents: product.priceCents, quantity: line.quantity };
    });
    const totalCents = subtotalCents - input.discountCents + input.shippingCents;
    if (subtotalCents !== input.subtotalCents || input.discountCents > subtotalCents ||
        !Number.isSafeInteger(totalCents) || totalCents < 0 || totalCents > 999999900) throw new Error('PRICE_CHANGED');
    const number = Math.max(metaSnap.exists() ? metaSnap.data().nextOrderNumber || 1 : 1, 1);
    const orderId = `CS-${String(number).padStart(4, '0')}`;
    const orderRef = item('orders', orderId);
    const existingOrder = await tx.get(orderRef);
    if (existingOrder.exists()) throw new Error('COUNTER_CONFLICT');
    refs.forEach((ref, i) => {
      const current = productSnaps[i].data();
      tx.update(ref, { stock: current.stock - lines[i].quantity, revision: (current.revision || 0) + 1 });
    });
    tx.set(orderRef, { ...input, id: orderId, lines, subtotalCents, totalCents,
      createdAt: new Date().toISOString(), status: 'completed' });
    tx.set(metaRef, { nextOrderNumber: number + 1 });
    return orderId;
  });
}
export async function cancelOrder(id) {
  check();
  const orderRef = item('orders', id);
  await runTransaction(db, async tx => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists() || orderSnap.data().status !== 'completed') throw new Error('ALREADY_CANCELLED');
    const order = orderSnap.data();
    const refs = order.lines.map(line => item('products', line.productId));
    const products = await Promise.all(refs.map(ref => tx.get(ref)));
    products.forEach((snap, i) => {
      if (!snap.exists() || snap.data().stock + order.lines[i].quantity > 9999999) throw new Error('NO_RESTORE');
    });
    refs.forEach((ref, i) => tx.update(ref, {
      stock: products[i].data().stock + order.lines[i].quantity,
      revision: (products[i].data().revision || 0) + 1
    }));
    tx.update(orderRef, { status: 'cancelled' });
  });
}

// Reemplaza respaldos pequeños de forma atómica; evita el límite de 500 escrituras por lote.
export async function restoreBackup(backup, current) {
  check();
  const currentProducts = new Map(current.products.map(p => [p.id, p]));
  const currentOrders = new Map(current.orders.map(o => [o.id, o]));
  const productIds = new Set(backup.products.map(p => p.id));
  const orderIds = new Set(backup.orders.map(o => o.id));
  const deletedProducts = [...currentProducts.keys()].filter(id => !productIds.has(id));
  const deletedOrders = [...currentOrders.keys()].filter(id => !orderIds.has(id));
  const count = deletedProducts.length + deletedOrders.length + backup.products.length + backup.orders.length + 1;
  if (count > 450) throw new Error('BACKUP_TOO_BIG');
  const batch = writeBatch(db);
  deletedProducts.forEach(id => batch.delete(item('products', id)));
  deletedOrders.forEach(id => batch.delete(item('orders', id)));
  backup.products.forEach(p => batch.set(item('products', p.id), { ...p, archived: !!p.archived, revision: 1 }));
  backup.orders.forEach(o => batch.set(item('orders', o.id), o));
  batch.set(meta(), { nextOrderNumber: backup.nextOrderNumber });
  await batch.commit();
}
