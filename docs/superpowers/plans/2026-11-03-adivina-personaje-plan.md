# Adivina el Personaje Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Juego web de 2 jugadores "Quién es Quién" por turnos, con arrastre ragdoll sincronizado.

**Architecture:** Node + Express + Socket.io; el servidor es autoridad de reglas (`game-logic.js` puro y testeable). Frontend HTML/CSS/JS puro.

**Tech Stack:** Node.js, express, socket.io, node:test, Python PIL (solo para optimizar imágenes).

**Spec:** `docs/superpowers/specs/2026-11-03-adivina-personaje-design.md`

## Global Constraints
- 2 vidas por jugador; personajes sorteados al azar y distintos, re-sorteados cada ronda.
- Botones exactos: "Mmm, para mí sí" / "Permitime dudar..."; respuestas Sí / No / No sé.
- Clic izquierdo tacha (privado); clic derecho agarra. Solo PC.
- El personaje del rival nunca viaja al cliente hasta el fin de ronda.

## Review Focus
- Mismo personaje para ambos jugadores: nunca ocurre (test).
- Jugador sin turno intenta preguntar/adivinar: el servidor lo rechaza (test).
- Tercer jugador entra a sala llena: error claro (test).
- Adivinar tras terminar la ronda: ignorado (test).
- Rival se desconecta a mitad de ronda: aviso y reconexión.

---

### Task 1: Reglas del juego (`game-logic.js`)
**Files:** Create `game-logic.js`, `tests/game-logic.test.js`
**Produces:** `createRoom(code)`, `addPlayer(room, socketId, name)`, `setReady(room, id)`, `startRound(room, characterIds, rng)`, `ask(room, id, text)`, `answer(room, id, ans)`, `guess(room, id, characterId)`, `viewFor(room, id)`, `rematchVote(room, id, yes)`.
- [ ] Escribir tests (sorteo distinto, turnos, vidas, acierto/fallo, 0 vidas, sala llena, revancha) → verlos fallar
- [ ] Implementar → tests pasan
- [ ] Commit

### Task 2: Servidor (`server.js`)
Socket.io: eventos `createRoom`, `joinRoom`, `ready`, `ask`, `answer`, `notes`, `drag`, `drop`, `guess`, `cancelGuess`, `rematch`; reconexión por token. Sirve `public/` y `characters.json`.
- [ ] Implementar y probar con dos clientes socket.io de prueba

### Task 3: Imágenes
Optimizar a webp (alto máx. 360 px), generar `public/characters.json` (`id`, `name`, `file`).

### Task 4: Frontend
`index.html`, `style.css`, `game.js`: lobby, galería (clic izq/der), ragdoll, zona "?", chat, notas, marcador, revancha, sonidos opcionales, estados de error.

### Task 5: Verificación y despliegue
Prueba end-to-end con Playwright (2 contextos), `README.md` con pasos de Render, commit de archivos a la carpeta del usuario.
