# Reglas de cambios del proyecto

## Reglas obligatorias

1. Antes de modificar una pantalla existente, conservar su estructura y estilos actuales.
2. No reemplazar `src/App.jsx` ni `src/index.css` completos para añadir una funcionalidad aislada.
3. Toda nueva pantalla debe vivir en un componente independiente.
4. La navegación entre landing y editor solo debe cambiar la vista; no debe reconstruir ni rediseñar el editor.
5. No añadir elementos visuales, secciones, iconos o textos que no estén en la referencia proporcionada.
6. Antes de cada cambio, revisar el CSS de referencia y comparar la captura resultante.
7. Después de cada cambio, ejecutar `npm run build`.
8. Los cambios de navegación no deben alterar dimensiones, posiciones, tipografías ni espaciados del editor.
9. Mantener los cambios visuales del usuario: sidebar ampliada, `Home`, `Projects`, `User`, eliminación de `Members`, chatbox aumentado un 7% y textarea multilínea.
10. No declarar una restauración exacta si solo se ha hecho una aproximación.

## Historial visual confirmado

- **2026-08-29**: Ajustes CSS para alinear con Frame 4 de referencia:
  - Sidebar ampliada a 278px (original 241.5px + ~15%)
  - Posiciones de nav items ajustadas según Frame 4
  - Chatbox aumentado ~7% (677x246 → 724x263)
  - Textarea multilínea ampliada (145px → 155px)
  - Section title "Principal" → "Projects"
  - Placeholder del chatbox ajustado
  - Settings bottom position ajustada (25px → 46px)

- Se creó una landing page independiente.
- La landing debe llevar al editor mediante `#editor`.
- El editor previo a la landing usaba el layout de `Frame 4` a 1440×900.
- Sidebar base: 241.5px, separador en x=260.5px.
- El usuario pidió posteriormente ampliar la sidebar aproximadamente un 15%.
- Se añadió `Home` sobre `Projects`.
- `All Projects` pasó a llamarse `Projects`.
- `Creator` de la sidebar pasó a llamarse `User`.
- `Members` se eliminó.
- El chatbox se aumentó aproximadamente un 7%.
- El textarea debe permitir varias líneas y aprovechar el espacio central del chatbox.
- La landing tiene su propio fondo, navegación, botones y flecha SVG.
- La vista del editor debe conservarse al navegar desde la landing.
