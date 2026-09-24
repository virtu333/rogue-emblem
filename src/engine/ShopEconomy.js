import economy from '../../data/economy.json' with { type: 'json' };

// Stored shop offers keep their quoted price through reload/re-entry. Item base
// prices remain untouched so resale never earns back an act markup.
export function actShopPrice(basePrice, act) {
  if (!Number.isFinite(basePrice) || basePrice <= 0) return basePrice;
  return Math.ceil(basePrice * (economy.shopPriceByAct[act] || 1));
}
