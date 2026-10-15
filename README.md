# CinnamonShofis — Inventario y pedidos en la nube

Aplicación web adaptable a **computadoras y celulares** para administrar una repostería. Guarda datos en **Firebase Cloud Firestore**, permite iniciar sesión con correo y contraseña (**Firebase Authentication**) y sincroniza cambios en tiempo real entre dispositivos que utilicen **la misma cuenta**. Los roles y postres aparecen con **nombres e iniciales, no con emojis**.

## Funciones

- Inventario: nuevos productos, precios en MXN, costo unitario, existencias, mínimo de alerta, edición y archivo/restauración. Archivamos en lugar de borrar para conservar referencias en ventas anteriores.
- Menú: mostrar u ocultar productos; imprimir menú en PDF con el navegador.
- Pedidos: añadir roles y postres, aumentar/disminuir unidades, subtotal, descuento, envío, total, cambio y notas.
- Ventas: historial y cancelación de pedidos con reposición de existencias.
- **Sincronización automática**: los cambios guardados en Firebase aparecen en el celular y la PC con la misma cuenta. Los pedidos usan **transacciones de Firestore** para evitar descontar dos veces el mismo stock si hay ventas simultáneas.
- Seguridad: datos separados por UID y `firestore.rules` con permisos de solo la cuenta autenticada.
- Respaldos: exportar JSON e importar un respaldo de esta versión o la anterior. Las importaciones REEMPLAZAN datos en la nube, no los combinan.
- Recuperación de contraseña mediante correo electrónico.

> **IMPORTANTE:** El ZIP incluye la integración, pero **NO es posible conectar una base de datos real sin TU configuración de Firebase**. Debes completar los pasos siguientes antes de poder registrar ventas. El proyecto inicia vacío, sin productos ficticios. No requiere Node.js ni un backend propio: GitHub Pages sirve la interfaz, Firebase almacena los datos.

## 1. Crear el proyecto de Firebase

1. Visita [Firebase Console](https://console.firebase.google.com/) con tu cuenta de Google.
2. Pulsa **Crear proyecto**. Por ejemplo, `cinnamonshofis` (el identificador único puede ser distinto). Elige tu región en los servicios correspondientes.
3. En **Configuración del proyecto → General → Tus aplicaciones**, registra una **aplicación web** (`</>`). No necesitas activar Firebase Hosting: publicaremos en GitHub Pages.
4. Firebase mostrará `firebaseConfig` con varias propiedades. Abre el archivo `firebase-config.js` del ZIP y **cambia** `apiKey`, `authDomain`, `projectId`, `appId` por los valores reales. Si tu configuración incluye `messagingSenderId` o `storageBucket`, son opcionales para estas funciones.

Ejemplo del archivo (VALORES DE EJEMPLO, NO FUNCIONALES):

```js
export const firebaseConfig = {
  apiKey: 'TU_API_KEY_DE_FIREBASE',
  authDomain: 'tu-proyecto.firebaseapp.com',
  projectId: 'tu-proyecto',
  appId: '1:123456:web:abc123'
};
```

**La configuración web de Firebase NO es un secreto:** puede aparecer en el repositorio. No subas archivos de credenciales privadas (`serviceAccountKey.json`) ni claves administrativas. La protección de los datos depende de Authentication y de las reglas de Firestore.

## 2. Activar correo y contraseña

1. En Firebase Console, abre **Authentication → Sign-in method (Método de acceso)**.
2. Habilita **Email/Password (Correo electrónico/contraseña)** y guarda.
3. En **Authentication → Settings → Authorized domains (Dominios autorizados)**, añade **`TU-USUARIO.github.io`** (sin `https://` ni `/CinnamonShofis`). Si usas un dominio propio, añádelo también.

## 3. Crear Firestore y establecer reglas SEGURAS

1. En Firebase Console, abre **Firestore Database → Create database (Crear base de datos)**.
2. Selecciona la región y base de datos predeterminada. Si el asistente pide modo de seguridad, elige **producción** y continúa (la interfaz no funcionará hasta publicar las reglas).
3. Abre la pestaña **Rules (Reglas)**, copia **todo** el contenido de `firestore.rules` del ZIP y pulsa **Publish (Publicar)**.
4. Las reglas autorizan lectura/escritura únicamente cuando el usuario inició sesión y su UID coincide con el espacio `/users/{uid}/...`. Así otro usuario registrado no puede leer el inventario de tu cuenta.

**No uses** reglas de tipo `allow read, write: if true` o reglas abiertas para pruebas. En una web pública permitirían que cualquiera leyera o alterara las ventas.

## 4. Publicar en GitHub Pages

1. Crea o abre tu repositorio `CinnamonShofis` en [GitHub](https://github.com/).
2. Sube **los archivos de esta versión** a la **raíz** del repositorio: `index.html`, `app.js`, `cloud.js`, `firebase-config.js`, `styles.css`, etc. El `index.html` debe quedar en la raíz, no dentro de una segunda carpeta.
3. En **Settings → Pages**, elige **Deploy from a branch**, rama `main`, carpeta `/(root)` y **Save**.
4. Abre la página `https://TU-USUARIO.github.io/CinnamonShofis/` desde computadora o celular.
5. Pulsa **Crear una cuenta**, registra un correo/contraseña y empieza a añadir roles al inventario. En el otro dispositivo inicia sesión **con el mismo correo y contraseña**.

En los primeros segundos la app puede indicar **Conectando…**. Si muestra un error de permisos, comprueba el proyecto, la activación de Authentication y las reglas publicadas. Si cambias los archivos en GitHub, actualiza `CACHE_NAME` en `service-worker.js` para evitar recursos antiguos.

## 5. Cómo se guardan los datos

- Cada cambio enviado se confirma en **Firestore**, no solo en `localStorage`.
- `onSnapshot()` escucha productos, pedidos y contador para refrescar las pantallas automáticamente.
- Un pedido usa una transacción: lee stock y precio más recientes, impide vender más unidades de las disponibles, registra la venta y descuenta stock **en una misma operación atómica**.
- La cancelación también usa una transacción y restaura las existencias.
- Los cambios en productos se controlan con revisiones para evitar sobrescrituras accidentales por otra ventana.
- **Se necesita conexión para guardar operaciones.** Sin internet puedes ver una vista previamente almacenada por el navegador en algunos casos, pero NO puedes confirmar pedidos ni editar el inventario. No es un sistema de ventas offline.
- Todos los datos del negocio están vinculados al **UID de la cuenta**: distintas cuentas tienen inventarios separados. Si quieres que dos trabajadores vean la misma tienda, usa la misma cuenta bajo tu responsabilidad; esta versión no incluye roles de empleado ni permisos compartidos.
- Firebase aplica cuotas. El plan **Spark** incluye uso sin costo dentro de sus límites; consulta [tarifas actuales](https://firebase.google.com/pricing) y [cuotas de Firestore](https://firebase.google.com/docs/firestore/pricing). Evita habilitar servicios con facturación sin comprender sus cargos.

## 6. Migrar los datos de la versión anterior

**Opción A — Mismo navegador y misma URL de GitHub Pages:**

- La versión anterior guardaba sus datos en `localStorage`. Si entras a la **cuenta nueva y vacía**, la aplicación detecta esos datos (si no eran solo los cinco productos de demostración) y ofrece importar los productos y ventas a Firebase.
- No se borra el archivo local anterior. Realiza un respaldo por precaución.

**Opción B — Un archivo JSON:**

1. Desde la versión anterior, pulsa **Respaldo** y conserva el archivo `.json`.
2. Abre esta nueva versión, inicia sesión y pulsa **Importar respaldo** al pie de la página.
3. Confirma solo si deseas **reemplazar todos los datos de la nube** por el archivo. Haz primero un respaldo del inventario actual y cierra cualquier otra sesión para evitar colisiones.
4. Se admiten hasta **450 operaciones Firestore** en una restauración (productos + pedidos y eliminaciones). Para archivos más grandes se requiere una migración especial o una herramienta administrativa.

Esta versión no sincroniza el inventario de dos cuentas distintas. Si necesitas trabajar en equipo con cuentas individuales, se tendría que agregar un modelo de negocio con miembros y permisos.

## 7. Probar en tu computadora

Sirve esta carpeta mediante un servidor de archivos local, por ejemplo:

```bash
python -m http.server 8000
```

Abre `http://localhost:8000`. Necesitas internet para descargar el SDK modular de Firebase por CDN y comunicarte con Firebase. También puedes editar y probar directamente en GitHub Pages (HTTPS).

## Estructura

```text
CinnamonShofis-Nube/
├── index.html              Pantallas y formulario de acceso
├── styles.css              Interfaz PC/móvil
├── app.js                  Interfaz, cálculos, validación e importación
├── cloud.js                Firebase Authentication y Firestore
├── firebase-config.js      TU configuración web de Firebase (rellenar)
├── firestore.rules         Reglas privadas (pegar en Firebase Console)
├── service-worker.js       Caché de interfaz PWA (no pedidos offline)
├── manifest.webmanifest    Instalable en dispositivos compatibles
├── icon-192.png            Icono
├── icon-512.png            Icono
├── favicon.svg             Favicon
├── LICENSE                 Licencia MIT
└── README.md               Instrucciones
```

## Alcance y limitaciones

- La sincronización y el registro en la nube **se activan después de tu configuración personal de Firebase**. No son verificables con una cuenta real desde este ZIP sin las credenciales del proyecto.
- Un respaldo puede contener nombres de clientes y notas. Guárdalo en un lugar privado.
- No es un sistema fiscal ni emite CFDI; se limita a inventario, pedidos y registro interno.
- En inventarios o historiales enormes convendría implementar paginación de ventas y consultas optimizadas. Esta versión carga todos los documentos de la cuenta.
- La exportación JSON desde la app es el sistema de respaldo incluido; no es lo mismo que las copias administradas de Firestore.
