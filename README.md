# Grimorio de Adivinanzas

Juego web de 2 jugadores tipo "Quién es Quién" con los personajes de la carpeta `PERSONAJES`.

## Cómo se juega
1. Uno crea una sala y le pasa el link al otro. Los dos eligen apodo y aprietan **Listo**.
2. El juego sortea al azar un personaje distinto para cada uno. Solo vos ves el tuyo.
3. Por turnos, el jugador activo escribe una pregunta de Sí/No y el rival responde.
4. **Clic izquierdo** en la galería: tacha/destacha un personaje (es privado).
5. **Clic derecho mantenido**: agarra una imagen y la arrastra (el rival la ve moverse en vivo).
6. Para adivinar: soltá la imagen en el cuadrado **?** (solo en tu turno) y confirmá con **"Mmm, para mí sí"**. Con **"Permitime dudar..."** cancelás y la imagen sale despedida al centro.
7. Cada jugador tiene 2 vidas. Si acertás, ganás la ronda. Al final se pregunta si juegan otra ronda.
8. Las notas de cada jugador las ve y las puede editar el rival.

Se juega en computadora con mouse.

## Probarlo en tu PC
Necesitás [Node.js](https://nodejs.org) 18 o superior.

```bash
npm install
npm start
```

Abrí http://localhost:3000 en dos pestañas (o en dos navegadores) para jugar los dos lados.

Para correr los tests: `npm test`

## Publicarlo para jugar con un link (gratis en Render)
1. Subí esta carpeta a un repositorio de GitHub (sin `node_modules`, ya está en `.gitignore`).
2. Entrá a https://render.com, creá una cuenta y elegí **New → Web Service**, conectando ese repositorio.
3. Configurá: **Runtime:** Node · **Build Command:** `npm install` · **Start Command:** `npm start` · **Instance type:** Free.
4. Cuando termine el deploy, Render te da un link tipo `https://tu-juego.onrender.com`. Ese es el link del juego.

Nota: en el plan gratis el servidor se duerme tras un rato sin uso; la primera visita puede tardar hasta ~30 segundos en despertar (el juego muestra un aviso).

## Estructura
- `server.js`: servidor HTTP + WebSocket (librería `ws`), salas en memoria.
- `game-logic.js`: reglas puras (sorteo, turnos, vidas, adivinanzas, revancha).
- `public/`: interfaz (`index.html`, `style.css`, `net.js`, `sfx.js`, `ragdoll.js`, `game.js`), imágenes optimizadas en `personajes/` y `characters.json`.
- `tests/`: tests automáticos.

## Agregar o cambiar personajes
Las imágenes originales están en `PERSONAJES/`. Las que usa el juego son versiones livianas (.webp) en `public/personajes/`, listadas en `public/characters.json` (`id`, `name`, `file`). Para agregar una, sumá la imagen a `public/personajes/` y una entrada en `characters.json`. El nombre que se muestra es el campo `name`.
