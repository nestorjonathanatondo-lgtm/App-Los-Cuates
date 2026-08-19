LOS CUATES - APP FINAL CON SPLASH JM + DESIGN + RECIBO MEMBRETADO
====================================================================

SPLASH SCREEN NUEVO:
- Fondo negro #000
- Logo JM (jm_logo.jpg) con movimiento suave: flotación + escala + glow
- Texto "Design" debajo del logo (Cormorant Garamond, letter-spacing 0.38em)
- Barra Cargando con animación shimmer 0% -> 100%
- Dura 2.8 segundos y hace fade-out a la app

CAMBIOS ANTERIORES INCLUIDOS:
- Sin botón Fijar mi puesto (puesto fijo Chihuahua con Candela)
- Solo botón Mi ubicación (cliente)
- Sin QR de puesto, solo QR cliente (pedido con folio)
- Nuevo QR para descargar app (puedes pegar URL GitHub Pages/Vercel)
- Recibo membretado con logo Los Cuates y sarape al 15% opacidad (se genera automático al pedir)
- Puesto: 25.436413, -100.998999 - WhatsApp 844-225-2582

ARCHIVOS:
- index.html (app completa con splash + recibo)
- jm_logo.jpg (logo JM splash)
- los_cuates_logo.webp (logo cuates con sombrero y moño)
- sarape.webp (fondo sarape 11% app, 15% recibo)
- manifest.json + sw.js (PWA)
- capacitor.config.json + package.json (APK)
- .github/workflows/build-apk.yml (compila APK automático)

GENERAR APK - 3 FORMAS:

OPCION 1 - GITHUB ACTIONS (MAS FACIL, GRATIS, TE DA APK LISTO):
1. Crea repo en github.com (ej: los-cuates-app)
2. Sube TODO el contenido de este zip al repo
3. Ve a pestaña Actions -> verás "Build APK Los Cuates - JM Design Splash" corriendo
4. Espera 4-5 minutos
5. Al terminar, entra al workflow -> abajo verás Artifacts -> descarga "los-cuates-JM-DESIGN-APK"
6. Ahí está tu app-debug.apk lista para instalar (incluye splash JM con Design)

OPCION 2 - PWABuilder (APK + AAB PARA PLAY STORE):
1. Sube a GitHub Pages: Settings -> Pages -> Deploy from branch main -> Save
2. Copia tu URL: https://tunombre.github.io/los-cuates-app/
3. Ve a pwabuilder.com, pega URL -> Build My PWA -> Android -> Generate Package
4. Descarga APK y AAB listos
5. El splash JM con Design ya está dentro de la web, se verá al abrir la app

OPCION 3 - LOCAL CON ANDROID STUDIO (SIN INTERNET):
1. Instala Node.js y Android Studio
2. En esta carpeta ejecuta:
   npm install
   npx cap add android
   npx cap copy
   npx cap open android
3. En Android Studio: Build -> Build APK(s)
4. Tu APK estará en android/app/build/outputs/apk/debug/

ICONO DE LA APP:
- Usa los_cuates_logo.webp como icono (512x512)
- Para splash nativo de Android, usa jm_logo.jpg como splash image en capacitor.config.json si quieres splash nativo además del web

NOTA SPLASH:
El splash negro con JM y Design es un splash web que se ve al iniciar la app tanto en PWA como en APK. Si quieres además splash nativo de Android (antes del web), agrega en capacitor.config.json:
"plugins": {
  "SplashScreen": {
    "launchShowDuration": 3000,
    "backgroundColor": "#000000"
  }
}
