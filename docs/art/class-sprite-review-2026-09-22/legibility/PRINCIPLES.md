# Map-sprite legibility principles — September 22

## Goal and evidence

A player should locate a unit, recognize its faction, then distinguish its class
without opening inspection. Identity comes next. Large-sheet beauty is insufficient.
These are working art-direction rules inferred from the user's four supplied
reference screenshots, pasted critique, and our map renders—not measured player-study results.

Reference observations:
- The blue/orange range-overlay scenes demonstrate why a unit needs contour and
  shape information independent of its faction hue: the floor itself becomes blue.
- The small handheld map screenshot uses compact heads, concentrated color and
  simple silhouettes. Borrow that prioritization without copying its extreme simplification.
- The dim 3D interior separates lit actors from the environment. Borrow selective
  highlights and readable mass, not a blanket glow or an unsupported 3D pipeline.
- Edric, Sera and Pegasus Knight are accepted local comparison anchors. Preserve
  them during the experiment rather than changing every variable at once.

## Rules for generation and selection

1. **Class silhouette before individual decoration.** Give each confusable class
   a distinct stance, weapon direction and clothing mass. Distinguish Myrmidon /
   Mercenary / Thief even as black shapes. A unique silhouette for every promotion
   may be unrealistic; preserve family resemblance but add a substantial class cue.
2. **Readable body size, controlled weapon overhang.** Use the existing 32px tile
   and 64px texture canvas, with the current foot anchor. Judge body height separately
   from the full alpha bounds. A tall sword must not shrink its wielder. Crouching
   units should remain visibly lower, not be enlarged to match standing head height.
3. **Lit actors, restrained world.** Use an intentional bright face/cloth/metal mass
   and deep contour against middle-value terrain. Avoid covering every surface in
   noisy highlights. Test grayscale, especially on swamp. Value is important, but
   it does not replace silhouette, hue or spatial separation.
4. **Faction color is an area, not piping.** Prefer a coherent medium-blue cloth
   block to navy straps and brown-dominated outfits. Enemy crimson should remain
   readable against ground and danger overlays. Keep existing faction rings as a
   second cue; color alone cannot carry faction information.
5. **Grounded, compact proportions.** Target roughly three heads tall, adjusting
   for class. Enough face, hand and weapon pixels to read; not ornamental realism
   reduced until all details collapse. Keep feet and hands in clear clusters.
6. **One dominant class cue and one identity cue.** Archer bow, knight mass,
   cleric staff head, thief hood/crouch. Hair shape, skin tone or headgear provides
   identity. Do not make every recruit an Edric/Sera/Astrid recolor. Preserve the
   recruit's identity across promotion and the named lords' established appearances.
7. **Outline and palette are contextual.** Use charcoal contours and selective
   light edges; don't prescribe pure black everywhere or a halo everywhere. Favor
   a few coherent hue-shifted ramps. A 10–14 color target is a simplification aid,
   not a guarantee that generated artwork has a strict indexed palette.
8. **Keep the pixel grid coherent.** Generate for map use; inspect at final texture
   size, not only large sheet size. Nearest-neighbor resizing alone does not repair
   inconsistent pixel clusters. Manual cleanup/palette reduction may be needed
   before production. Do not force a 64px anchored texture into a 32px canvas.
9. **States are part of the design.** Review ready/acted, selection and danger
   overlays, fog and status effects. A default dark sprite leaves little room to
   communicate an acted state. Do not confuse grayscale diagnostics with the actual
   acted treatment: the game uses a multiplicative tint, not true desaturation.
10. **Terrain changes are a separate experiment.** Lowering terrain microcontrast
    may help, but this batch holds it fixed to test the sprites themselves. Preserve
    terrain recognition if that experiment is undertaken later.

## Sword-class design contract

| Class | Primary shape | Weapon cue | Avoid |
|---|---|---|---|
| Myrmidon | Narrow upright unarmored wrap | Slender raised blade, tip near head | Tall blade shrinking body; knight armor |
| Mercenary | Broad square shoulders, short tabard | Wide blade over shoulder | Same downward sword as every infantry |
| Thief | Low forward crouch, compact hood | Short low blade | Full-length cape or tall armored stance |

The enemy treatment must retain these shape cues; crimson alone does not distinguish classes.

## Review gate

- Compare old/new on identical staged map positions at phone viewport size.
- Inspect adjacent units as well as isolated sheets; test grass/swamp and stone.
- Check silhouette and grayscale without claiming these substitute for real vision testing.
- Check actual acted tint; later test live selection/danger/fog and animation.
- Name the three sword classes without relying on labels; user review is still required.
- Verify anchor, cut boundaries and weapon overlaps. Compare to unchanged lords/mount.
- Archive source, exact prompt, texture and map capture. Reject a beautiful large
  sheet if the reduced map sprite fails.

## Scope of this experiment

Three classes × two player appearances + one enemy = nine samples, with a second
Myrmidon iteration prompted by map evidence. The first raised sword made the body
small; it is archived rather than silently discarded. Game code, terrain assets,
production sprites and saves remain unchanged. Static renderer comparisons are
not a playtest or production sign-off. Color-vision simulation, fog, animation and
all promotion families remain future gates.

## Results from this pass

- Nine textures extracted with zero alpha-boundary warnings; six comparison
  buttons and 17 displayed images verified with no broken images.
- Thief and Mercenary have more distinct shapes in the map and silhouette views.
- Myrmidon's second pass has a more prominent body but over-shortens the blade;
  adjust hand position and blade length in the next art iteration.
- The attempted Phaser acted-tint call did not establish a visible rendered
  difference in this harness. Its capture is retained as diagnostic evidence,
  not presented as successful acted-state validation.
- Hair variation contributes individual identity, but stance/weapon masses are
  the larger class-level change. All recognition assessments remain qualitative.
