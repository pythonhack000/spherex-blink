// Famous objects by name, so name search works without any server.
// Positions are J2000 unless a proper motion and epoch are given.
const CATALOG = [
  { name: 'Vega', ru: 'Вега', ra: 279.2347, dec: 38.7837, pmra: 200.9, pmdec: 287.5, kind: 'star' },
  { name: 'Altair', ru: 'Альтаир', ra: 297.6958, dec: 8.8683, pmra: 536.2, pmdec: 385.3, kind: 'star' },
  { name: 'Arcturus', ru: 'Арктур', ra: 213.9153, dec: 19.1824, pmra: -1093.4, pmdec: -1999.4, kind: 'star' },
  { name: 'Rigel', ru: 'Ригель', ra: 78.6345, dec: -8.2016, pmra: 1.3, pmdec: 0.5, kind: 'star' },
  { name: 'Antares', ru: 'Антарес', ra: 247.3519, dec: -26.432, pmra: -10.2, pmdec: -23.2, kind: 'star' },
  { name: 'Aldebaran', ru: 'Альдебаран', ra: 68.9802, dec: 16.5093, pmra: 63.4, pmdec: -189.4, kind: 'star' },
  { name: 'Polaris', ru: 'Полярная звезда', ra: 37.9545, dec: 89.2641, pmra: 44.5, pmdec: -11.9, kind: 'star' },
  { name: 'Deneb', ru: 'Денеб', ra: 310.358, dec: 45.2803, pmra: 2.0, pmdec: 1.9, kind: 'star' },
  { name: 'Tau Ceti', ru: 'Тау Кита', ra: 26.017, dec: -15.9375, pmra: -1721.0, pmdec: 854.2, kind: 'star' },
  { name: 'Epsilon Eridani', ru: 'Эпсилон Эридана', ra: 53.2327, dec: -9.4583, pmra: -975.2, pmdec: 19.5, kind: 'star' },
  { name: 'Wolf 359', ru: 'Вольф 359', ra: 164.1203, dec: 7.0147, pmra: -3842, pmdec: -2725, kind: 'star' },
  { name: 'Triangulum Galaxy', ru: 'Галактика Треугольника', aliases: ['m33'], ra: 23.4621, dec: 30.6599, fov: 0.5, kind: 'galaxy' },
  { name: "Bode's Galaxy", ru: 'Галактика Боде', aliases: ['m81'], ra: 148.8882, dec: 69.0653, fov: 0.25, kind: 'galaxy' },
  { name: 'Cigar Galaxy', ru: 'Галактика Сигара', aliases: ['m82'], ra: 148.9697, dec: 69.6797, fov: 0.2, kind: 'galaxy' },
  { name: 'Large Magellanic Cloud', ru: 'Большое Магелланово Облако', aliases: ['lmc', 'бмо'], ra: 80.8938, dec: -69.7561, fov: 0.5, kind: 'galaxy' },
  { name: 'Small Magellanic Cloud', ru: 'Малое Магелланово Облако', aliases: ['smc', 'ммо'], ra: 13.1867, dec: -72.8286, fov: 0.5, kind: 'galaxy' },
  { name: 'Crab Nebula', ru: 'Крабовидная туманность', aliases: ['m1'], ra: 83.6331, dec: 22.0145, fov: 0.2, kind: 'nebula' },
  { name: 'Ring Nebula', ru: 'Туманность Кольцо', aliases: ['m57'], ra: 283.3963, dec: 33.0292, fov: 0.1, kind: 'nebula' },
  { name: 'Horsehead Nebula', ru: 'Туманность Конская Голова', ra: 85.2458, dec: -2.4583, fov: 0.25, kind: 'nebula' },
  { name: 'Carina Nebula', ru: 'Туманность Киля', ra: 161.265, dec: -59.684, fov: 0.5, kind: 'nebula' },
  { name: 'Dumbbell Nebula', ru: 'Туманность Гантель', aliases: ['m27'], ra: 299.9016, dec: 22.7211, fov: 0.2, kind: 'nebula' },
  { name: 'Beehive Cluster', ru: 'Ясли', aliases: ['m44', 'praesepe'], ra: 130.1, dec: 19.667, fov: 0.5, kind: 'cluster' },
  { name: 'Galactic Centre', ru: 'Центр Галактики', aliases: ['sgr a', 'sagittarius a', 'центр млечного пути'], ra: 266.405, dec: -28.936, fov: 0.25, kind: 'custom' },
];

const normalise = (text) => text.toLowerCase().replace(/ё/g, 'е').replace(/['’`]/g, '').replace(/\s+/g, ' ').trim();

function namesOf(entry) {
  return [entry.name, entry.ru, entry.key, ...(entry.aliases ?? [])].filter(Boolean).map(normalise);
}

/** Exact names win over the start of a name, which wins over a part of one. */
export function findByName(query, presets = []) {
  const wanted = normalise(query);
  if (wanted.length < 2) return null;
  const entries = [...presets, ...CATALOG];
  return (
    entries.find((entry) => namesOf(entry).includes(wanted)) ??
    entries.find((entry) => namesOf(entry).some((name) => name.startsWith(wanted))) ??
    (wanted.length >= 3 ? entries.find((entry) => namesOf(entry).some((name) => name.includes(wanted))) : null) ??
    null
  );
}

/** Everything the search list offers: ready places first, then other famous objects. */
export function searchMatches(query, presets) {
  const wanted = normalise(query);
  const entries = [...presets.filter((preset) => preset.category !== 'challenge'), ...presets.filter((preset) => preset.category === 'challenge'), ...CATALOG];
  if (!wanted) return entries;
  return entries.filter((entry) => namesOf(entry).some((name) => name.includes(wanted)));
}
