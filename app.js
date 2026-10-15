import * as cloud from './cloud.js';
/* CinnamonShofis · datos en Cloud Firestore, autenticación con Firebase. */
(() => {
  'use strict';

  const STORAGE_KEY = 'cinnamonshofis-data-v1';
  const MAX_MONEY_CENTS = 999_999_900;
  const CATEGORIES = ['Roles de canela', 'Postres', 'Bebidas', 'Otros'];
  const PAGE_META = {
    dashboard: ['MI REPOSTERÍA / INICIO', '¡Hola, CinnamonShofis! <span class="heading-sparkle">✷</span>'],
    orders: ['VENTAS / NUEVO PEDIDO', 'Vamos por otro pedido <span class="heading-sparkle">✷</span>'],
    inventory: ['CATÁLOGO / INVENTARIO', 'Tus existencias <span class="heading-sparkle">✷</span>'],
    menu: ['CATÁLOGO / MENÚ', 'Un menú muy dulce <span class="heading-sparkle">✷</span>'],
    history: ['VENTAS / HISTORIAL', 'Registro de ventas <span class="heading-sparkle">✷</span>']
  };
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const money = (cents) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(cents / 100);
  const localDay = (dateValue = new Date()) => {
    const d = new Date(dateValue);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const dateLabel = (dateValue) => new Date(dateValue).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const newId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const isNonNegativeInt = (n, limit = 9_999_999) => Number.isInteger(n) && n >= 0 && n <= limit;
  const validMoney = (n) => isNonNegativeInt(n, MAX_MONEY_CENTS);
  const parseCents = (value) => {
    if (value === '' || value === null || value === undefined) return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > MAX_MONEY_CENTS / 100) return null;
    return Math.round(n * 100);
  };
  const parseWhole = (value) => {
    if (value === '') return null;
    const n = Number(value);
    return isNonNegativeInt(n) ? n : null;
  };
  const byName = (a, b) => a.name.localeCompare(b.name, 'es');
  const stockState = (product) => product.stock === 0 ? 'out' : product.stock <= product.minimum ? 'low' : 'ok';
  const stockText = (product) => product.stock === 0 ? 'Agotado' : product.stock <= product.minimum ? 'Stock bajo' : 'Disponible';
  const initials = name => name.trim().split(/\s+/).slice(0, 2).map(word => word[0]?.toLocaleUpperCase('es') || '').join('');
  const emptyState = (icon, title, message) => `<div class="empty-state"><span class="empty-icon" aria-hidden="true">${icon}</span><strong>${esc(title)}</strong>${esc(message)}</div>`;

  const emptyData = () => ({ version: 2, nextOrderNumber: 1, products: [], orders: [] });

  // Comprobación del respaldo antes de incorporarlo a la aplicación.
  function isValidProduct(p) {
    return p && typeof p.id === 'string' && p.id.length > 0 && p.id.length <= 100
      && typeof p.name === 'string' && p.name.trim().length > 0 && p.name.length <= 70
      && CATEGORIES.includes(p.category)
      && validMoney(p.priceCents) && validMoney(p.costCents)
      && isNonNegativeInt(p.stock) && isNonNegativeInt(p.minimum) && typeof p.inMenu === 'boolean';
  }
  function isValidOrder(o) {
    return o && typeof o.id === 'string' && o.id.length <= 100 && o.id.length > 0
      && typeof o.createdAt === 'string' && !Number.isNaN(Date.parse(o.createdAt))
      && ['completed', 'cancelled'].includes(o.status)
      && typeof o.customer === 'string' && o.customer.length <= 80
      && typeof o.notes === 'string' && o.notes.length <= 300
      && ['Efectivo', 'Transferencia', 'Tarjeta', 'Otro'].includes(o.method)
      && validMoney(o.subtotalCents) && validMoney(o.discountCents) && validMoney(o.shippingCents) && validMoney(o.totalCents)
      && Array.isArray(o.lines) && o.lines.length > 0 && o.lines.length <= 1000
      && o.lines.every(line => line && typeof line.productId === 'string' && line.productId.length <= 100
        && typeof line.name === 'string' && line.name.length <= 70
        && validMoney(line.unitPriceCents) && Number.isInteger(line.quantity) && line.quantity >= 1 && line.quantity <= 9_999_999)
      && o.lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0) === o.subtotalCents
      && o.discountCents <= o.subtotalCents && o.subtotalCents - o.discountCents + o.shippingCents === o.totalCents;
  }
  function validateData(data) {
    if (!data || ![1, 2].includes(data.version) || !Array.isArray(data.products) || !Array.isArray(data.orders)) return false;
    if (data.products.length > 10000 || data.orders.length > 50000 || !Number.isSafeInteger(data.nextOrderNumber) || data.nextOrderNumber < 1) return false;
    if (!data.products.every(isValidProduct) || !data.orders.every(isValidOrder)) return false;
    const productIds = data.products.map(product => product.id);
    const orderIds = data.orders.map(order => order.id);
    return new Set(productIds).size === productIds.length && new Set(orderIds).size === orderIds.length;
  }
  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return validateData(parsed) ? parsed : null;
    } catch (error) {
      console.error('No fue posible leer los datos guardados:', error);
      return null;
    }
  }

  let data = emptyData();
  const legacyData = loadData();
  let cloudReady = false;
  let busy = false;
  let unsubscribeCloud = null;
  let sessionCounter = 0;
  let lastSyncWasCached = false;
  let editingRevision = null;
  let legacyAsked = false;
  let registerMode = false;
  let cart = new Map();
  let editingId = null;
  let toastTimer;

  function notify(message, error = false) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.toggle('error', error);
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3700);
  }
  function setBusy(state) {
    busy = state;
    $$('.mutation').forEach(el => el.disabled = state || !cloudReady);
    $('#completeOrderBtn').disabled = state || !cloudReady || cart.size === 0;
    $('#saveProductBtn').disabled = state || !cloudReady;
  }
  function cloudError(error) {
    console.error(error);
    const translations = {
      OFFLINE: 'Sin conexión. Reconéctate para guardar cambios.',
      CONFLICT: 'Los datos cambiaron en otro dispositivo. Revisa la información e inténtalo otra vez.',
      NO_STOCK: 'Cambió el inventario: ya no hay suficientes unidades. Revisa el pedido.',
      PRICE_CHANGED: 'El precio o el total cambió. Revisa el pedido antes de confirmarlo.',
      ALREADY_CANCELLED: 'Este pedido ya está cancelado.',
      NO_RESTORE: 'No se pudo devolver el inventario. Revisa el producto.',
      BACKUP_TOO_BIG: 'Este respaldo es demasiado grande para restaurarlo de una vez (máx. 450 operaciones).',
      COUNTER_CONFLICT: 'El número del pedido ya existe. Revisa el contador al importar respaldos.',
      TOO_MANY_PRODUCTS: 'Máximo 80 productos distintos por pedido.',
      'permission-denied': 'Firebase rechazó el acceso. Revisa las reglas de Firestore y que la cuenta esté activa.',
      'unavailable': 'Firebase no está disponible o no tienes conexión. Inténtalo nuevamente.'
    };
    notify(translations[error?.message] || translations[error?.code] || 'No se pudieron guardar los cambios en Firebase.', true);
  }
  async function action(callback) {
    if (busy || !cloudReady) return false;
    setBusy(true);
    try { await callback(); return true; }
    catch (error) { cloudError(error); return false; }
    finally { setBusy(false); }
  }
  function getProduct(id) { return data.products.find((p) => p.id === id); }
  function normalizeCart() {
    for (const [id, quantity] of cart) {
      const product = getProduct(id);
      if (!product || product.archived || !product.inMenu || product.stock < 1) cart.delete(id);
      else if (quantity > product.stock) cart.set(id, product.stock);
    }
  }
  function showView(page) {
    if (!PAGE_META[page]) page = 'dashboard';
    $$('.page').forEach((section) => {
      const isActive = section.dataset.page === page;
      section.classList.toggle('active', isActive);
      section.hidden = !isActive;
    });
    $$('[data-nav]').forEach((button) => {
      const isActive = button.dataset.nav === page;
      button.classList.toggle('active', isActive);
      if (isActive) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    $('#pageEyebrow').textContent = PAGE_META[page][0];
    $('#pageTitle').innerHTML = PAGE_META[page][1];
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function renderDashboard() {
    const todayOrders = data.orders.filter(order => order.status === 'completed' && localDay(order.createdAt) === localDay());
    const completed = [...data.orders].filter(order => order.status === 'completed').reverse();
    const low = data.products.filter(product => !product.archived && stockState(product) !== 'ok').sort((a, b) => a.stock - b.stock);
    $('#statSales').textContent = money(todayOrders.reduce((sum, order) => sum + order.totalCents, 0));
    $('#statOrders').textContent = String(todayOrders.length);
    $('#statStock').textContent = String(data.products.filter(product => !product.archived).reduce((sum, product) => sum + product.stock, 0));
    $('#statLow').textContent = String(low.length);
    $('#recentOrders').innerHTML = completed.length ? `<div class="simple-list">${completed.slice(0, 4).map(order => `
      <div class="simple-list-row"><span class="mini-icon" aria-hidden="true">CS</span><div><div class="main-line">${esc(order.id)}</div><div class="sub-line">${esc(order.customer || 'Cliente general')} · ${esc(dateLabel(order.createdAt))}</div></div><div class="list-right"><strong>${money(order.totalCents)}</strong><div><span class="badge-soft ok">Completado</span></div></div></div>`).join('')}</div>` : emptyState('CS', 'Todavía no hay ventas', 'Tu primer pedido aparecerá aquí.');
    $('#lowStockItems').innerHTML = low.length ? `<div class="simple-list">${low.slice(0, 4).map(product => `
      <div class="simple-list-row"><span class="mini-icon" aria-hidden="true">${esc(initials(product.name))}</span><div><div class="main-line">${esc(product.name)}</div><div class="sub-line">Quedan ${product.stock} unidades · Mínimo ${product.minimum}</div></div><div class="list-right"><span class="badge-soft ${stockState(product)}">${stockText(product)}</span></div></div>`).join('')}</div>` : emptyState('OK', '¡Todo en orden!', 'Tienes existencias suficientes.');
  }

  function filteredOrderProducts() {
    const query = $('#orderSearch').value.trim().toLocaleLowerCase('es');
    return data.products.filter(p => !p.archived && p.inMenu && p.name.toLocaleLowerCase('es').includes(query)).sort(byName);
  }
  function renderPicker() {
    const products = filteredOrderProducts();
    $('#availableProductsCount').textContent = `${data.products.filter(product => !product.archived && product.inMenu && product.stock > 0).length} productos disponibles`;
    $('#productPicker').innerHTML = products.length ? products.map(product => `
      <button type="button" class="picker-card" data-add-cart="${esc(product.id)}" ${product.stock === 0 ? 'disabled' : ''} aria-label="Agregar ${esc(product.name)} al pedido">
        <span class="product-art" aria-hidden="true">${esc(initials(product.name))}</span><span class="picker-info"><strong>${esc(product.name)}</strong><small>${product.stock ? `${product.stock} disponibles` : 'Agotado'}</small><b>${money(product.priceCents)}</b></span><span class="add-indicator" aria-hidden="true">+</span>
      </button>`).join('') : emptyState('CS', 'No hay productos que mostrar', 'Agrega uno al menú o cambia la búsqueda.');
  }
  function cartSubtotal() {
    let subtotal = 0;
    for (const [id, quantity] of cart) {
      const p = getProduct(id);
      if (p) subtotal += p.priceCents * quantity;
    }
    return subtotal;
  }
  function totals() {
    const subtotalCents = cartSubtotal();
    const discountCents = parseCents($('#discountInput').value);
    const shippingCents = parseCents($('#shippingInput').value);
    const totalCents = discountCents === null || shippingCents === null ? null : subtotalCents - discountCents + shippingCents;
    return { subtotalCents, discountCents, shippingCents, totalCents };
  }
  function renderCart() {
    const items = [...cart.entries()];
    const count = items.reduce((sum, [, quantity]) => sum + quantity, 0);
    $('#cartItemsBadge').textContent = String(count);
    $('#cartNavCount').textContent = String(count);
    $('#cartNavCount').hidden = count === 0;
    $('#cartItems').innerHTML = items.length ? items.map(([id, quantity]) => {
      const product = getProduct(id);
      if (!product) return '';
      return `<div class="cart-line"><div><div class="cart-line-name">${esc(product.name)}</div><div class="cart-line-meta">${money(product.priceCents)} c/u</div><div class="qty-controls"><button class="qty-button" type="button" data-cart-less="${esc(id)}" aria-label="Quitar una unidad de ${esc(product.name)}">−</button><span class="qty-number">${quantity}</span><button class="qty-button" type="button" data-cart-more="${esc(id)}" aria-label="Agregar una unidad de ${esc(product.name)}" ${quantity >= product.stock ? 'disabled' : ''}>+</button></div></div><div class="cart-line-right"><div class="cart-line-price">${money(quantity * product.priceCents)}</div><button class="text-link" style="margin-top:12px" type="button" data-cart-remove="${esc(id)}">Quitar</button></div></div>`;
    }).join('') : emptyState('CS', 'Tu pedido está vacío', 'Selecciona un rol para comenzar.');
    renderTotals();
  }
  function renderTotals() {
    const value = totals();
    $('#subtotalValue').textContent = money(value.subtotalCents);
    $('#discountValue').textContent = `-${value.discountCents === null ? '—' : money(value.discountCents)}`;
    $('#shippingValue').textContent = value.shippingCents === null ? '—' : money(value.shippingCents);
    $('#totalValue').textContent = value.totalCents === null || value.totalCents < 0 ? '—' : money(value.totalCents);
    const isCash = $('#paymentMethod').value === 'Efectivo';
    $('#cashReceivedField').hidden = !isCash;
    const received = parseCents($('#cashReceived').value);
    $('#changeRow').hidden = !isCash || received === null || value.totalCents === null || value.totalCents < 0;
    if (!$('#changeRow').hidden) {
      const remaining = received - value.totalCents;
      $('#changeLabel').textContent = remaining >= 0 ? 'Cambio a entregar' : 'Falta por pagar';
      $('#changeValue').textContent = money(Math.abs(remaining));
    }
    $('#completeOrderBtn').disabled = cart.size === 0 || !cloudReady || busy;
  }
  function changeCart(id, change) {
    const product = getProduct(id);
    if (!product || product.archived || !product.inMenu) return;
    const current = cart.get(id) || 0;
    const next = current + change;
    if (next > product.stock) { notify(`Solo quedan ${product.stock} unidades de ${product.name}.`, true); return; }
    if (next <= 0) cart.delete(id);
    else cart.set(id, next);
    renderCart();
  }
  function clearOrderForm() {
    cart.clear();
    $('#customerName').value = '';
    $('#discountInput').value = '0';
    $('#shippingInput').value = '0';
    $('#paymentMethod').value = 'Efectivo';
    $('#cashReceived').value = '';
    $('#orderNotes').value = '';
  }
  async function completeOrder() {
    if (busy || !cloudReady) return;
    normalizeCart();
    if (!cart.size) { notify('Agrega al menos un producto.', true); renderCart(); return; }
    const { subtotalCents, discountCents, shippingCents, totalCents } = totals();
    if (discountCents === null || shippingCents === null) return notify('Descuento y envío deben ser válidos.', true);
    if (discountCents > subtotalCents) return notify('El descuento no puede superar el subtotal.', true);
    if (!validMoney(subtotalCents) || !validMoney(totalCents)) return notify('El total supera el máximo permitido.', true);
    const received = $('#cashReceived').value;
    if ($('#paymentMethod').value === 'Efectivo' && received !== '' &&
        (parseCents(received) === null || parseCents(received) < totalCents)) {
      return notify('El efectivo debe cubrir el total.', true);
    }
    const lines = [...cart.entries()].map(([productId, quantity]) => ({
      productId, quantity, unitPriceCents: getProduct(productId)?.priceCents
    }));
    const result = await action(async () => {
      const orderId = await cloud.addOrder({
        lines, subtotalCents, discountCents, shippingCents,
        customer: $('#customerName').value.trim(), notes: $('#orderNotes').value.trim(),
        method: $('#paymentMethod').value
      });
      clearOrderForm();
      renderCart();
      showView('history');
      notify(`Pedido ${orderId} registrado en la nube. Inventario actualizado.`);
    });
    if (!result) renderCart();
  }
  function filterInventory() {
    const query = $('#inventorySearch').value.trim().toLocaleLowerCase('es');
    const filter = $('#inventoryFilter').value;
    return data.products.filter(product => {
      if (!product.name.toLocaleLowerCase('es').includes(query)) return false;
      if (filter === 'archived') return !!product.archived;
      if (product.archived) return false;
      if (filter === 'low') return stockState(product) !== 'ok';
      if (filter === 'out') return product.stock === 0;
      if (filter === 'inMenu') return product.inMenu;
      if (filter === 'hidden') return !product.inMenu;
      return true;
    }).sort(byName);
  }
  function renderInventory() {
    const products = filterInventory();
    $('#inventorySummary').textContent = `${products.length} de ${data.products.length} productos · Datos sincronizados con Firebase.`;
    $('#inventoryTableBody').innerHTML = products.length ? products.map(p => `<tr>
      <td><div class="product-cell"><span class="mini-icon" aria-hidden="true">${esc(initials(p.name))}</span><div><strong>${esc(p.name)}</strong><small>${esc(p.category)}</small></div></div></td>
      <td><strong>${money(p.priceCents)}</strong></td><td><span class="stock-count">${p.stock}</span> <small>/ mín. ${p.minimum}</small></td>
      <td><span class="badge-soft ${p.archived ? 'out' : stockState(p)}">${p.archived ? 'Archivado' : stockText(p)}</span></td>
      <td><input class="menu-switch" type="checkbox" data-toggle-menu="${esc(p.id)}" ${p.archived ? 'disabled' : ''} ${p.inMenu ? 'checked' : ''} aria-label="Mostrar ${esc(p.name)} en el menú" /></td>
      <td class="row-actions"><button class="small-button" data-edit="${esc(p.id)}" type="button">Editar</button> <button class="small-button danger" data-delete="${esc(p.id)}" type="button">${p.archived ? 'Restaurar' : 'Archivar'}</button></td>
    </tr>`).join('') : `<tr><td colspan="6">${emptyState('CS', 'Sin coincidencias', 'Prueba con otro filtro o agrega un producto.')}</td></tr>`;
    $('#inventoryMobile').innerHTML = products.length ? products.map(p => `<div class="inventory-card"><span class="mini-icon" aria-hidden="true">${esc(initials(p.name))}</span><div class="inventory-card-body"><div class="inventory-card-head"><div><strong>${esc(p.name)}</strong><small>${esc(p.category)}</small></div><span class="inventory-card-price">${money(p.priceCents)}</span></div><div class="inventory-card-line"><span class="badge-soft ${p.archived ? 'out' : stockState(p)}">${p.archived ? 'Archivado' : stockText(p)}</span><small>${p.stock} unidades · Mín. ${p.minimum}</small></div><div class="inventory-card-actions"><label><input class="menu-switch" type="checkbox" data-toggle-menu="${esc(p.id)}" ${p.archived ? 'disabled' : ''} ${p.inMenu ? 'checked' : ''} aria-label="Mostrar ${esc(p.name)} en el menú" /> En menú</label><div><button class="small-button" data-edit="${esc(p.id)}" type="button">Editar</button> <button class="small-button danger" data-delete="${esc(p.id)}" type="button">${p.archived ? 'Restaurar' : 'Archivar'}</button></div></div></div></div>`).join('') : emptyState('CS', 'Sin coincidencias', 'Prueba con otro filtro o agrega un producto.');
  }
  function renderMenu() {
    const menu = data.products.filter(product => !product.archived && product.inMenu).sort(byName);
    $('#menuGrid').innerHTML = menu.length ? menu.map(p => `<article class="menu-card"><div class="menu-card-art" aria-hidden="true">${esc(initials(p.name))}</div><div class="menu-card-body"><span class="menu-card-category">${esc(p.category)}</span><h3>${esc(p.name)}</h3><div class="menu-card-footer"><span class="menu-card-price">${money(p.priceCents)}</span><span class="badge-soft ${p.stock === 0 ? 'out' : 'ok'}">${p.stock === 0 ? 'Agotado' : 'Disponible'}</span></div></div></article>`).join('') : emptyState('CS', 'Tu menú está vacío', 'Activa la opción «Mostrar en el menú» en Inventario.');
  }
  function renderHistory() {
    const orders = [...data.orders].reverse();
    const completed = orders.filter(order => order.status === 'completed');
    $('#allTimeSales').textContent = money(completed.reduce((sum, order) => sum + order.totalCents, 0));
    $('#allTimeOrders').textContent = String(completed.length);
    $('#historyCount').textContent = `${orders.length} pedidos`;
    $('#historyList').innerHTML = orders.length ? orders.map(order => `<details class="history-item ${order.status === 'cancelled' ? 'cancelled-item' : ''}"><summary><span class="mini-icon" aria-hidden="true">${order.status === 'cancelled' ? 'CN' : 'CS'}</span><span><span class="history-id">${esc(order.id)}</span><span class="history-sub">${esc(order.customer || 'Cliente general')} · ${esc(dateLabel(order.createdAt))}</span></span><span class="history-price"><strong>${money(order.totalCents)}</strong><small>${order.status === 'cancelled' ? 'Cancelado' : esc(order.method)}</small></span><span class="chevron" aria-hidden="true">›</span></summary><div class="history-content"><table><tbody>${order.lines.map(line => `<tr><td>${esc(line.name)} <span class="muted-small">× ${line.quantity}</span></td><td>${money(line.unitPriceCents * line.quantity)}</td></tr>`).join('')}<tr><td>Subtotal</td><td>${money(order.subtotalCents)}</td></tr><tr><td>Descuento / Envío</td><td>−${money(order.discountCents)} / +${money(order.shippingCents)}</td></tr><tr><td><strong>Total</strong></td><td><strong>${money(order.totalCents)}</strong></td></tr></tbody></table>${order.notes ? `<p class="history-notes"><strong>Notas:</strong> ${esc(order.notes)}</p>` : ''}${order.status === 'completed' ? `<div class="history-actions"><button type="button" class="small-button danger" data-cancel-order="${esc(order.id)}">Cancelar y devolver al inventario</button></div>` : '<p class="history-notes">Este pedido fue cancelado y no suma a las ventas.</p>'}</div></details>`).join('') : emptyState('CS', 'Todavía no hay pedidos', 'Confirma tu primera venta para verla aquí.');
  }
  function renderAll() { renderDashboard(); renderPicker(); renderCart(); renderInventory(); renderMenu(); renderHistory(); }

  function openProductDialog(id = null) {
    if (!cloudReady || busy) return;
    editingId = id;
    const product = id ? getProduct(id) : null;
    if (id && !product) return notify('Ya no existe el producto.', true);
    editingRevision = product?.revision ?? null;
    $('#productForm').reset();
    $('#productError').hidden = true;
    $('#productDialogTitle').textContent = product ? 'Editar producto' : 'Nuevo producto';
    $('#saveProductBtn').textContent = product ? 'Guardar cambios' : 'Agregar producto';
    $('#productName').value = product?.name || '';
    $('#productCategory').value = product?.category || 'Roles de canela';
    $('#productPrice').value = product ? String(product.priceCents / 100) : '';
    $('#productCost').value = product ? String(product.costCents / 100) : '';
    $('#productStock').value = product ? String(product.stock) : '0';
    $('#productMinimum').value = product ? String(product.minimum) : '5';
    $('#productInMenu').checked = product?.inMenu ?? true;
    $('#productDialog').showModal();
    $('#productName').focus();
  }
  function closeProductDialog() { $('#productDialog').close(); }
  function productError(text) { $('#productError').textContent = text; $('#productError').hidden = false; }
  async function saveProduct(event) {
    event.preventDefault();
    if (!cloudReady || busy) return;
    const name = $('#productName').value.trim();
    const category = $('#productCategory').value;
    const priceCents = parseCents($('#productPrice').value);
    const costCents = $('#productCost').value === '' ? 0 : parseCents($('#productCost').value);
    const stock = parseWhole($('#productStock').value);
    const minimum = parseWhole($('#productMinimum').value);
    if (!name || name.length > 70) return productError('Escribe un nombre válido (máximo 70 caracteres).');
    if (!CATEGORIES.includes(category)) return productError('Selecciona una categoría válida.');
    if (priceCents === null || costCents === null) return productError('Precio o costo no válidos.');
    if (stock === null || minimum === null) return productError('Existencias y mínimo deben ser enteros mayores o iguales a cero.');
    const product = { id: editingId || newId(), name, category, priceCents, costCents,
      stock, minimum, inMenu: $('#productInMenu').checked };
    const wasEditing = !!editingId;
    await action(async () => {
      await cloud.saveProduct(product, wasEditing ? { revision: editingRevision } : null);
      closeProductDialog();
      notify(wasEditing ? 'Producto actualizado en la nube.' : 'Producto agregado al inventario y menú.');
    });
  }
  async function toggleMenu(id, checked) {
    if (busy || !cloudReady) return renderInventory();
    const ok = await action(() => cloud.setMenu(id, checked));
    if (!ok) renderInventory();
  }
  async function deleteProduct(id) {
    const product = getProduct(id);
    if (!product || busy || !cloudReady) return;
    const archived = !product.archived;
    if (!window.confirm(archived
      ? `¿Archivar «${product.name}»? No aparecerá en el menú ni el inventario principal, pero conservarás su historial y podrás restaurarlo.`
      : `¿Restaurar «${product.name}» al inventario?`)) return;
    await action(async () => {
      await cloud.setArchive(id, archived);
      notify(archived ? 'Producto archivado. Puedes restaurarlo desde el filtro Archivados.' : 'Producto restaurado. Activa su menú cuando desees.');
    });
  }
  async function cancelOrder(id) {
    const order = data.orders.find(o => o.id === id);
    if (!order || order.status !== 'completed' || busy || !cloudReady) return;
    if (!window.confirm(`¿Cancelar ${order.id}? Se restaurarán sus unidades en el inventario.`)) return;
    await action(async () => {
      await cloud.cancelOrder(id);
      notify(`Pedido ${id} cancelado. Inventario restaurado en la nube.`);
    });
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `CinnamonShofis-respaldo-${localDay()}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Respaldo descargado. Guárdalo en un lugar seguro.');
  }
  async function restoreParsed(parsed, description = 'este respaldo') {
    if (!validateData(parsed)) return notify('Respaldo no válido.', true);
    if (!parsed.products.every(p => /^[a-zA-Z0-9_-]{1,100}$/.test(p.id)) ||
        !parsed.orders.every(o => /^[a-zA-Z0-9_-]{1,100}$/.test(o.id))) {
      return notify('Hay identificadores inválidos en el respaldo.', true);
    }
    if (!window.confirm(`¿Restaurar ${description} en tu cuenta de Firebase? REEMPLAZARÁ el inventario y las ventas en la nube, también en otros dispositivos. Haz antes un respaldo y cierra otras sesiones.`)) return;
    const maxOrderNumber = Math.max(0, ...parsed.orders.map(o => Number(/^CS-(\d+)$/.exec(o.id)?.[1] || 0)));
    const cleaned = { version: 2, products: parsed.products.map(({ emoji, ...p }) => p),
      orders: parsed.orders.map(o => ({ ...o, lines: o.lines.map(({emoji, ...line}) => line) })),
      nextOrderNumber: Math.max(parsed.nextOrderNumber, maxOrderNumber + 1) };
    if (await action(() => cloud.restoreBackup(cleaned, data))) {
      clearOrderForm();
      renderAll();
      showView('dashboard');
      notify('Datos restaurados y sincronizados con Firebase.');
    }
  }
  async function importBackup(file) {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) return notify('El respaldo supera los 15 MB.', true);
    let parsed;
    try { parsed = JSON.parse(await file.text()); }
    catch { return notify('No se pudo leer el archivo JSON.', true); }
    return restoreParsed(parsed);
  }

  // Eventos mediante delegación: funcionan para elementos que se vuelven a dibujar.
  document.addEventListener('click', (event) => {
    const navigation = event.target.closest('[data-nav]');
    const go = event.target.closest('[data-go]');
    const addProduct = event.target.closest('[data-action="add-product"]');
    const addCart = event.target.closest('[data-add-cart]');
    const less = event.target.closest('[data-cart-less]');
    const more = event.target.closest('[data-cart-more]');
    const remove = event.target.closest('[data-cart-remove]');
    const edit = event.target.closest('[data-edit]');
    const del = event.target.closest('[data-delete]');
    const cancel = event.target.closest('[data-cancel-order]');
    if (navigation) showView(navigation.dataset.nav);
    else if (go) showView(go.dataset.go);
    else if (addProduct) openProductDialog();
    else if (addCart) changeCart(addCart.dataset.addCart, 1);
    else if (less) changeCart(less.dataset.cartLess, -1);
    else if (more) changeCart(more.dataset.cartMore, 1);
    else if (remove) { cart.delete(remove.dataset.cartRemove); renderCart(); }
    else if (edit) openProductDialog(edit.dataset.edit);
    else if (del) deleteProduct(del.dataset.delete);
    else if (cancel) cancelOrder(cancel.dataset.cancelOrder);
  });
  document.addEventListener('change', (event) => {
    const toggle = event.target.closest('[data-toggle-menu]');
    if (toggle) toggleMenu(toggle.dataset.toggleMenu, toggle.checked);
  });
  $('#productForm').addEventListener('submit', saveProduct);
  $('#closeDialogBtn').addEventListener('click', closeProductDialog);
  $('#cancelDialogBtn').addEventListener('click', closeProductDialog);
  $('#productDialog').addEventListener('click', (event) => {
    if (event.target === $('#productDialog')) closeProductDialog();
  });
  $('#orderSearch').addEventListener('input', renderPicker);
  $('#inventorySearch').addEventListener('input', renderInventory);
  $('#inventoryFilter').addEventListener('change', renderInventory);
  ['#discountInput', '#shippingInput', '#cashReceived', '#paymentMethod'].forEach(selector => {
    $(selector).addEventListener('input', renderTotals);
    $(selector).addEventListener('change', renderTotals);
  });
  $('#completeOrderBtn').addEventListener('click', completeOrder);
  $('#printMenuBtn').addEventListener('click', () => window.print());
  $('#exportBtn').addEventListener('click', exportBackup);
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async event => {
    await importBackup(event.target.files[0]);
    event.target.value = '';
  });

  const todayText = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  $('#todayDate').textContent = todayText.charAt(0).toUpperCase() + todayText.slice(1);
  $('#dashboardDate').textContent = $('#todayDate').textContent;
  $('#footerYear').textContent = String(new Date().getFullYear());
  renderAll();
  showView('dashboard');

  function authMessage(message, error = false) {
    $('#authMessage').textContent = message;
    $('#authMessage').classList.toggle('error', error);
    $('#authMessage').hidden = !message;
  }
  function authError(error) {
    const code = error?.code || '';
    const translations = {
      'auth/invalid-credential': 'Correo o contraseña incorrectos.',
      'auth/email-already-in-use': 'Ese correo ya está registrado. Inicia sesión.',
      'auth/weak-password': 'La contraseña es muy débil. Usa al menos 6 caracteres.',
      'auth/invalid-email': 'El correo electrónico no es válido.',
      'auth/too-many-requests': 'Demasiados intentos. Vuelve a intentarlo más tarde.',
      'auth/unauthorized-domain': 'Agrega el dominio de GitHub Pages en Authentication → Settings → Authorized domains.',
      'auth/network-request-failed': 'No hay conexión con Firebase.'
    };
    authMessage(translations[code] || 'No fue posible acceder. Revisa Firebase y tu conexión.', true);
    console.error(error);
  }
  function updateConnection() {
    const message = !navigator.onLine ? 'Sin conexión: los cambios requieren internet'
      : lastSyncWasCached ? 'Verificando cambios en la nube…' : 'Datos sincronizados con Firebase';
    $('#syncState').textContent = message;
    $('#sidebarSync').textContent = message;
  }
  async function signedUserChanged(user) {
    sessionCounter++;
    const session = sessionCounter;
    unsubscribeCloud?.();
    unsubscribeCloud = null;
    cloudReady = false;
    busy = false;
    cart.clear();
    data = emptyData();
    if ($('#productDialog').open) $('#productDialog').close();
    $('#appShell').hidden = true;
    $('#authScreen').hidden = false;
    if (!user) { $('#loginForm').hidden = false; $('#authLogoutBtn').hidden = true; authMessage(''); return; }
    $('#loginForm').hidden = true;
    $('#authLogoutBtn').hidden = false;
    authMessage('Cargando tu inventario en Firebase…');
    $('#userEmail').textContent = user.email || 'Cuenta activa';
    $('#syncState').textContent = 'Conectando…';
    $('#sidebarSync').textContent = 'Conectando…';
    unsubscribeCloud = cloud.subscribe(async payload => {
      if (session !== sessionCounter) return;
      data = { version: 2, products: payload.products,
        orders: payload.orders.sort((a,b) => a.createdAt.localeCompare(b.createdAt)),
        nextOrderNumber: payload.nextOrderNumber };
      lastSyncWasCached = payload.fromCache;
      cloudReady = true;
      normalizeCart();
      renderAll();
      updateConnection();
      $('#authScreen').hidden = true;
      $('#appShell').hidden = false;
      if (!legacyAsked && legacyData && legacyData.products?.length && !data.products.length && !data.orders.length &&
          (legacyData.orders.length > 0 || legacyData.products.some(p => !String(p.id).startsWith('demo-')))) {
        legacyAsked = true;
        // Espera a recibir datos del servidor antes de ofrecer una migración; la caché puede estar desactualizada.
        if (!payload.fromCache) restoreParsed(legacyData, 'los datos guardados en este navegador (versión anterior)');
        else legacyAsked = false;
      }
    }, error => {
      if (session !== sessionCounter) return;
      cloudReady = false;
      $('#appShell').hidden = true;
      $('#authScreen').hidden = false;
      authMessage('No fue posible leer Firestore. Revisa las reglas y que la base de datos esté creada.', true);
      console.error(error);
    });
  }
  $('#authSwitch').addEventListener('click', () => {
    registerMode = !registerMode;
    $('#authTitle').textContent = registerMode ? 'Crear una cuenta' : 'Inicia sesión';
    $('#authSubmit').textContent = registerMode ? 'Crear cuenta' : 'Entrar a CinnamonShofis';
    $('#authSwitch').textContent = registerMode ? 'Ya tengo cuenta' : 'Crear una cuenta';
    authMessage('');
  });
  $('#resetPasswordBtn').addEventListener('click', async () => {
    if (!cloud.configured) return;
    const email = $('#authEmail').value.trim();
    if (!email) return authMessage('Escribe primero tu correo electrónico.', true);
    try { await cloud.resetPassword(email); authMessage('Si el correo tiene una cuenta registrada, recibirás instrucciones para restablecer tu contraseña.'); }
    catch (error) { authError(error); }
  });
  $('#loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('#authSubmit');
    button.disabled = true;
    authMessage('Conectando con Firebase…');
    try {
      const email = $('#authEmail').value.trim();
      const password = $('#authPassword').value;
      if (registerMode) await cloud.register(email, password);
      else await cloud.login(email, password);
      $('#authPassword').value = '';
    } catch (error) { authError(error); }
    finally { button.disabled = false; }
  });
  $('#authLogoutBtn').addEventListener('click', () => cloud.logout().catch(authError));
  $('#logoutBtn').addEventListener('click', async () => {
    if (busy) return;
    try { await cloud.logout(); }
    catch (error) { cloudError(error); }
  });
  window.addEventListener('online', updateConnection);
  window.addEventListener('offline', updateConnection);
  if (!cloud.configured) {
    authMessage('Configuración pendiente: abre firebase-config.js, pega los datos de tu proyecto Firebase y vuelve a publicar la página.', true);
    $('#loginForm').hidden = true;
    $('#authSwitch').hidden = true;
    $('#resetPasswordBtn').hidden = true;
  } else {
    try { cloud.initAuth(signedUserChanged, authError); }
    catch (error) { authError(error); }
  }
  // PWA: guarda solo archivos estáticos. Sin internet no se registran ventas.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js')
      .catch(error => console.warn('No se pudo activar PWA:', error)));
  }
})();
