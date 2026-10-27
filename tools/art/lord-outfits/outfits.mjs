// The lord outfits (docs/specs/lord-outfits.md): one alternate look per lord, drawn for the
// portrait (base and promoted) and the map sprite. Ids are save data (meta `lordOutfits`)
// and never change; names and descriptions are what the Wardrobe shows.
export const LORD_OUTFITS = Object.freeze([
  {
    id: 'ashen_crown',
    lord: 'Edric',
    name: 'Ashen Crown',
    look: 'a young man with messy brown hair and dark eyes, earnest and determined',
    outfit:
      'blackened, soot-dark steel plate on the shoulders and chest, scorched as if it walked out of a great fire, with thin ember-orange trim along the plate edges and a charcoal-grey cloak with a frayed, burnt hem in place of his teal scarf; a dull iron circlet sits in his hair',
  },
  {
    id: 'field_marshal',
    lord: 'Kira',
    name: 'Field Marshal',
    look: 'a young woman with silver-white hair in a side ponytail and sharp, calm eyes',
    outfit:
      "a long, high-collared grey officer's greatcoat with a double row of brass buttons and a dark sash, a leather map case slung on a strap across the chest, a black cravat; no armour",
  },
  {
    id: 'winter_ranger',
    lord: 'Voss',
    name: 'Winter Ranger',
    look: 'a weathered man in his thirties with long mid-brown hair tied back, a short brown beard and a tired, steady gaze',
    outfit:
      'a white-and-grey fur-lined hooded mantle with the hood down on his shoulders, pale quilted leather, a quiver of white-fletched arrows and the curve of a pale birch-wood bow over one shoulder',
  },
  {
    id: 'hollow_sun_vestments',
    lord: 'Sera',
    name: 'Hollow Sun Vestments',
    look: 'a young woman with long wavy red hair and green eyes, gentle and serious',
    outfit:
      'pale ivory and soft gold priestess vestments with a high collar, a sash embroidered with an eclipsed sun (a dark disc with a thin gold ring), and a thin gold circlet with a small dark eclipse disc on her brow; no glow, no halo of light',
  },
  {
    id: 'black_banner',
    lord: 'Rowan',
    name: 'Black Banner',
    look: 'a young man with short swept auburn-brown hair and a confident half-smile',
    outfit:
      'dark gunmetal cavalry plate with black lacquered pauldrons, a black cloth tabard trimmed in dull silver, and the end of a black pennant on a lance shaft rising behind one shoulder',
  },
  {
    id: 'storm_rider',
    lord: 'Astrid',
    name: 'Storm Rider',
    look: 'a young woman with long platinum-blonde hair in a high ponytail tied with a ribbon and cool blue eyes',
    outfit:
      'slate-grey scaled armour with lightning-blue enamel trim and a storm-blue ribbon and scarf, a small jagged lightning motif on the pauldron, a dark grey riding cape; no glow',
  },
  {
    id: 'old_guard',
    lord: 'Cael',
    name: 'Old Guard',
    look: 'a broad, stern man in his forties with short brown hair and a heavy jaw',
    outfit:
      'battered, dented bronze armour of an older age, a rounded open-faced bronze helm, a scratched bronze rim of a great tower shield at the edge of the frame by one shoulder, faded olive-green cloth; worn and proud',
  },
]);

export const OUTFIT_BY_ID = Object.freeze(Object.fromEntries(LORD_OUTFITS.map((o) => [o.id, o])));
