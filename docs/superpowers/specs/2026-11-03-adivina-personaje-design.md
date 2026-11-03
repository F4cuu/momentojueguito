# Adivina el Personaje — Documento de diseño

Fecha: 2026-11-03

## 1. Objetivo
Juego web para 2 jugadores (acceso por link) tipo "Quién es Quién". Cada jugador recibe en secreto un personaje y, por turnos, intenta adivinar el del rival mediante preguntas simples de Sí/No. Los personajes salen de la carpeta `PERSONAJES` (71 imágenes de Black Clover).

Éxito = dos personas en casas distintas abren el link, juegan una ronda completa y pueden jugar más rondas, con el arrastre de imágenes visible en tiempo real para ambos.

## 2. Requisitos
- Acceso por link; sala con código. Publicable gratis en la nube.
- Los dos jugadores aprietan "Listo" y arranca la partida.
- **Asignación aleatoria:** el servidor sortea al azar un personaje distinto para cada jugador al inicio de cada ronda (nunca el mismo para ambos; en rondas nuevas se vuelve a sortear). Cada jugador solo recibe el suyo; el del rival no se envía al cliente hasta el final de la ronda.
- Juego por turnos con chat de texto. Quien no tiene el turno responde con **Sí / No / No sé**; al responder, el turno pasa.
- Cada jugador tiene un bloc de notas visible y editable por el otro, sincronizado en vivo.
- Galería con los 71 personajes. Clic izquierdo tacha/destacha (privado). Clic derecho mantenido agarra la imagen.
- La imagen agarrada se mueve con físicas tipo ragdoll y el rival la ve moverse en tiempo real.
- Adivinar: soltar la imagen en el cuadrado "?" (lado opuesto a donde aparece el personaje propio) muestra los botones **"Mmm, para mí sí"** (confirma) y **"Permitime dudar..."** (cancela).
- 2 vidas por jugador. Fallar resta una y pasa el turno; con 0 vidas pierde. Acertar gana la ronda.
- Tras cada ronda se pregunta a ambos "¿Otra ronda?". Marcador de rondas ganadas.

## 3. Arquitectura
- Node.js + Express + Socket.io. Frontend en HTML/CSS/JS puro, sin frameworks.
- El servidor es la única autoridad de las reglas: sorteo, turnos, vidas, validación de adivinanzas. Las salas viven en memoria.
- Estructura:
  - `server.js`
  - `game-logic.js` (reglas puras, testeables)
  - `public/index.html`, `public/style.css`, `public/game.js`
  - `public/personajes/` (imágenes optimizadas; el nombre mostrado sale del nombre de archivo)
  - `tests/`

## 4. Flujo
1. **Lobby:** se crea una sala (código + link). El segundo jugador entra por el link. Cada uno elige apodo y pulsa "Listo".
2. **Inicio de ronda:** con ambos listos, el servidor sortea al azar los 2 personajes distintos y elige al azar quién empieza.
3. **Turno:** el jugador activo escribe una pregunta; el rival responde Sí/No/No sé; el turno pasa. Solo el jugador activo puede escribir (validado en el servidor).
4. **Adivinar:** al confirmar, el servidor compara con el personaje real del rival.
   - Acierto: la imagen hace animación de acierto, gana la ronda, se revelan ambos personajes.
   - Fallo: se pierde una vida, la imagen sale despedida como ragdoll hacia el centro de la pantalla y pasa el turno. Con 0 vidas, pierde.
   - "Permitime dudar...": la imagen sale despedida al centro de la pantalla, sin costo.
5. **Fin de ronda:** a ambos aparece "¿Otra ronda?". Si los dos aceptan: nuevo sorteo aleatorio, vidas reiniciadas, empieza quien perdió. Si alguno rechaza, termina la partida.

La imagen despedida queda como objeto suelto en el centro y puede volver a agarrarse.

## 5. Interfaz
- Galería abajo/centro; personaje secreto propio y vidas arriba en un costado; cuadrado "?" en el costado opuesto; chat lateral; notas propias y del rival una al lado de la otra; marcador de rondas arriba.
- Solo PC con mouse en esta versión (clic derecho para arrastrar).
- Estilo: grimorio oscuro (azul noche, detalles dorados, tipografía fantasiosa pero legible).
- Sonidos opcionales y breves, con botón de silencio.

## 6. Físicas y sincronización
- Arrastre con resorte, inercia, inclinación según velocidad y balanceo al frenar. Física propia liviana (sin librerías).
- El cliente emite la posición ~30 veces por segundo en porcentaje de pantalla; el rival interpola para suavizar.
- Al soltar en el "?", la imagen queda fija ahí y el rival la ve; los botones de confirmación solo los ve quien adivina.

## 7. Errores y casos límite
- Servidor dormido (plan gratis): mensaje "Despertando el servidor...".
- Desconexión: aviso al rival y reconexión automática a la misma sala durante unos minutos.
- Sala inexistente o llena: mensaje claro.
- Imágenes grandes (p. ej. Julius ~3 MB, Rill ~2 MB) se reducen a un tamaño liviano.
- Nombres de archivo con texto inapropiado se mostrarán tal cual salvo que el usuario los renombre.

## 8. Pruebas
- Tests automáticos de `game-logic.js`: sorteo (personajes distintos y aleatorios), turnos, vidas, adivinanza correcta/incorrecta, fin de ronda y revancha.
- Prueba manual de interfaz con dos pestañas.

## 9. Despliegue
Gratis en Render o Railway (Node + WebSockets). Se guía al usuario paso a paso.

## 10. Fuera de alcance
Celulares/táctil, cuentas de usuario, persistencia de partidas, más de 2 jugadores, partidas contra bot.
