'use strict';

/*
 * Localities and suburban railway lines, so recruiters can search the way people commute:
 * "Mulund", "anyone on the Harbour line", "within 3 stations of Thane".
 *
 * Stations are listed in travel order on each branch. Localities that are not stations are attached to their
 * nearest station, so they inherit its line(s).
 */

const LINES = {
  western: {
    label: 'Western line',
    branches: [['Churchgate', 'Marine Lines', 'Charni Road', 'Grant Road', 'Mumbai Central', 'Mahalaxmi', 'Lower Parel', 'Prabhadevi', 'Dadar',
      'Matunga Road', 'Mahim', 'Bandra', 'Khar Road', 'Santacruz', 'Vile Parle', 'Andheri', 'Jogeshwari', 'Ram Mandir', 'Goregaon', 'Malad', 'Kandivali',
      'Borivali', 'Dahisar', 'Mira Road', 'Bhayandar', 'Naigaon', 'Vasai Road', 'Nalasopara', 'Virar', 'Vaitarna', 'Saphale', 'Kelve Road', 'Palghar',
      'Umroli', 'Boisar', 'Vangaon', 'Dahanu Road']]
  },
  central: {
    label: 'Central line',
    branches: [
      ['CSMT', 'Masjid', 'Sandhurst Road', 'Byculla', 'Chinchpokli', 'Currey Road', 'Parel', 'Dadar', 'Matunga', 'Sion', 'Kurla', 'Vidyavihar', 'Ghatkopar',
        'Vikhroli', 'Kanjurmarg', 'Bhandup', 'Nahur', 'Mulund', 'Thane', 'Kalwa', 'Mumbra', 'Diva', 'Kopar', 'Dombivli', 'Thakurli', 'Kalyan'],
      ['Kalyan', 'Shahad', 'Ambivli', 'Titwala', 'Khadavli', 'Vasind', 'Asangaon', 'Atgaon', 'Thansit', 'Khardi', 'Umbermali', 'Kasara'],
      ['Kalyan', 'Vithalwadi', 'Ulhasnagar', 'Ambernath', 'Badlapur', 'Vangani', 'Shelu', 'Neral', 'Bhivpuri Road', 'Karjat', 'Palasdhari', 'Kelavli', 'Dolavli', 'Lowjee', 'Khopoli']
    ]
  },
  harbour: {
    label: 'Harbour line',
    branches: [
      ['CSMT', 'Masjid', 'Sandhurst Road', 'Dockyard Road', 'Reay Road', 'Cotton Green', 'Sewri', 'Wadala Road', 'GTB Nagar', 'Chunabhatti', 'Kurla',
        'Tilak Nagar', 'Chembur', 'Govandi', 'Mankhurd', 'Vashi', 'Sanpada', 'Juinagar', 'Nerul', 'Seawoods-Darave', 'CBD Belapur', 'Kharghar', 'Mansarovar',
        'Khandeshwar', 'Panvel'],
      ['Wadala Road', "King's Circle", 'Mahim', 'Bandra', 'Khar Road', 'Santacruz', 'Vile Parle', 'Andheri', 'Jogeshwari', 'Ram Mandir', 'Goregaon']
    ]
  },
  trans_harbour: {
    label: 'Trans-Harbour line',
    branches: [
      ['Thane', 'Airoli', 'Rabale', 'Ghansoli', 'Kopar Khairane', 'Turbhe', 'Juinagar', 'Nerul', 'Seawoods-Darave', 'CBD Belapur', 'Kharghar', 'Mansarovar', 'Khandeshwar', 'Panvel'],
      ['Turbhe', 'Sanpada', 'Vashi']
    ]
  },
  uran: {
    label: 'Nerul–Uran line',
    branches: [['Nerul', 'Seawoods-Darave', 'CBD Belapur', 'Bamandongri', 'Kharkopar', 'Gavhan', 'Ranjanpada', 'Nhava Sheva', 'Dronagiri', 'Uran']]
  },
  vasai_diva: {
    label: 'Vasai–Diva–Panvel line',
    branches: [['Vasai Road', 'Juchandra', 'Kaman Road', 'Kharbao', 'Bhiwandi Road', 'Kopar', 'Diva', 'Dativali', 'Nilaje', 'Taloja Panchanand', 'Navade Road', 'Kalamboli', 'Panvel']]
  }
};

// Region and city of each place. Places named here but not on any line are localities (see NEAR below).
const REGIONS = {
  'South Mumbai': { city: 'Mumbai', places: ['Churchgate', 'Marine Lines', 'Charni Road', 'Grant Road', 'Mumbai Central', 'Mahalaxmi', 'Lower Parel', 'Prabhadevi',
    'CSMT', 'Masjid', 'Sandhurst Road', 'Byculla', 'Chinchpokli', 'Currey Road', 'Parel', 'Dockyard Road', 'Reay Road', 'Cotton Green', 'Sewri',
    'Colaba', 'Cuffe Parade', 'Nariman Point', 'Fort', 'Worli', 'Tardeo', 'Malabar Hill', 'Breach Candy', 'Girgaon', 'Kalbadevi', 'Mazgaon', 'Nagpada', 'Agripada'] },
  'Central Mumbai': { city: 'Mumbai', places: ['Dadar', 'Matunga', 'Matunga Road', 'Mahim', 'Sion', 'Wadala Road', "King's Circle", 'GTB Nagar', 'Dharavi', 'Antop Hill', 'Naigaon Dadar'] },
  'Western suburbs': { city: 'Mumbai', places: ['Bandra', 'Khar Road', 'Santacruz', 'Vile Parle', 'Andheri', 'Jogeshwari', 'Ram Mandir', 'Goregaon', 'Malad',
    'Kandivali', 'Borivali', 'Dahisar', 'Juhu', 'Versova', 'Lokhandwala', 'Oshiwara', 'Marol', 'Saki Naka', 'Chakala', 'BKC', 'Kalina', 'Aarey',
    'Malvani', 'Charkop', 'Gorai', 'Magathane', 'Poisar', 'Mith Chowki'] },
  'Eastern suburbs': { city: 'Mumbai', places: ['Kurla', 'Vidyavihar', 'Ghatkopar', 'Vikhroli', 'Kanjurmarg', 'Bhandup', 'Nahur', 'Mulund', 'Chunabhatti', 'Tilak Nagar',
    'Chembur', 'Govandi', 'Mankhurd', 'Powai', 'Chandivali', 'Trombay', 'Deonar', 'Anushakti Nagar', 'Asalpha', 'Pant Nagar', 'Vikhroli Park Site'] },
  'Mira-Bhayandar': { city: 'Mira Road', places: ['Mira Road', 'Bhayandar', 'Kashimira'] },
  'Vasai-Virar': { city: 'Vasai', places: ['Naigaon', 'Vasai Road', 'Nalasopara', 'Virar', 'Evershine', 'Juchandra'] },
  Palghar: { city: 'Palghar', places: ['Vaitarna', 'Saphale', 'Kelve Road', 'Palghar', 'Umroli', 'Boisar', 'Vangaon', 'Dahanu Road', 'Tarapur'] },
  Thane: { city: 'Thane', places: ['Thane', 'Kalwa', 'Mumbra', 'Diva', 'Ghodbunder Road', 'Majiwada', 'Wagle Estate', 'Kolshet', 'Hiranandani Estate', 'Kasarvadavali',
    'Manpada', 'Vartak Nagar', 'Naupada', 'Kopri', 'Balkum', 'Pokhran Road', 'Kausa', 'Shil Phata', 'Dativali', 'Nilaje', 'Owale', 'Brahmand', 'Patlipada', 'Louiswadi'] },
  Bhiwandi: { city: 'Bhiwandi', places: ['Bhiwandi', 'Bhiwandi Road', 'Kaman Road', 'Kharbao'] },
  'Kalyan-Dombivli': { city: 'Kalyan', places: ['Kopar', 'Dombivli', 'Thakurli', 'Kalyan', 'Shahad', 'Ambivli', 'Titwala', 'Vithalwadi', 'Khadakpada', 'Palava', 'Lodha Palava'] },
  'Ulhasnagar-Ambernath-Badlapur': { city: 'Ulhasnagar', places: ['Ulhasnagar', 'Ambernath', 'Badlapur', 'Vangani', 'Shelu'] },
  'Karjat-Kasara': { city: 'Karjat', places: ['Neral', 'Bhivpuri Road', 'Karjat', 'Palasdhari', 'Kelavli', 'Dolavli', 'Lowjee', 'Khopoli', 'Khadavli', 'Vasind',
    'Asangaon', 'Atgaon', 'Thansit', 'Khardi', 'Umbermali', 'Kasara', 'Shahapur'] },
  'Navi Mumbai': { city: 'Navi Mumbai', places: ['Airoli', 'Rabale', 'Ghansoli', 'Kopar Khairane', 'Turbhe', 'Vashi', 'Sanpada', 'Juinagar', 'Nerul', 'Seawoods-Darave',
    'CBD Belapur', 'Kharghar', 'Mansarovar', 'Khandeshwar', 'Mahape', 'Pawane', 'Ulwe', 'Kamothe', 'Kalamboli', 'Taloja', 'Taloja Panchanand', 'Navade Road',
    'Bamandongri', 'Kharkopar', 'Gavhan', 'Ranjanpada', 'Dronagiri', 'Nhava Sheva', 'Uran', 'Digha', 'Ghansoli Gaon'] },
  Panvel: { city: 'Panvel', places: ['Panvel', 'New Panvel'] },
  Pune: { city: 'Pune', places: ['Hinjewadi', 'Wakad', 'Baner', 'Balewadi', 'Aundh', 'Pashan', 'Kothrud', 'Karve Nagar', 'Warje', 'Shivajinagar', 'Deccan', 'Pune Camp',
    'Koregaon Park', 'Kalyani Nagar', 'Viman Nagar', 'Kharadi', 'Wagholi', 'Hadapsar', 'Magarpatta', 'Kondhwa', 'Undri', 'Katraj', 'Swargate', 'Bibwewadi',
    'Sinhagad Road', 'Dhayari', 'Pimple Saudagar', 'Pimple Gurav', 'Pimpri', 'Chinchwad', 'Akurdi', 'Nigdi', 'Bhosari', 'Moshi', 'Chakan', 'Talegaon', 'Ravet',
    'Tathawade', 'Punawale', 'Yerwada', 'Dhanori', 'Lohegaon', 'Vishrantwadi', 'Bavdhan', 'Mundhwa', 'Wanowrie', 'Fatima Nagar', 'Dapodi', 'Kasarwadi'] },
  Bengaluru: { city: 'Bengaluru', places: ['Whitefield', 'Electronic City', 'Koramangala', 'HSR Layout', 'Marathahalli', 'Indiranagar', 'BTM Layout', 'Jayanagar', 'Hebbal',
    'Yelahanka', 'Bellandur', 'Sarjapur Road', 'JP Nagar', 'Banashankari', 'Rajajinagar', 'Malleshwaram', 'KR Puram', 'Bannerghatta Road', 'Hosur Road'] },
  Hyderabad: { city: 'Hyderabad', places: ['Gachibowli', 'Hitech City', 'Madhapur', 'Kondapur', 'Kukatpally', 'Ameerpet', 'Begumpet', 'Banjara Hills', 'Jubilee Hills',
    'Miyapur', 'Uppal', 'LB Nagar', 'Dilsukhnagar', 'Manikonda', 'Financial District'] }
};

// Cities inside a region that differ from the region's city.
const CITY_OF = {
  Dombivli: 'Dombivli', Kopar: 'Dombivli', Thakurli: 'Dombivli', Palava: 'Dombivli', 'Lodha Palava': 'Dombivli',
  Ambernath: 'Ambernath', Badlapur: 'Badlapur', Vangani: 'Badlapur', Shelu: 'Badlapur',
  Virar: 'Virar', Nalasopara: 'Nalasopara', Bhayandar: 'Bhayandar',
  Boisar: 'Boisar', Tarapur: 'Boisar', 'Dahanu Road': 'Dahanu', Kasara: 'Kasara', Khopoli: 'Khopoli', Neral: 'Neral',
  Kalamboli: 'Panvel', Kamothe: 'Panvel', Taloja: 'Navi Mumbai', Uran: 'Uran', Dronagiri: 'Uran', 'Nhava Sheva': 'Uran'
};

// Localities that are not stations: their nearest station.
const NEAR = {
  Colaba: 'Churchgate', 'Cuffe Parade': 'Churchgate', 'Nariman Point': 'Churchgate', Fort: 'CSMT', Worli: 'Lower Parel', Tardeo: 'Mumbai Central',
  'Malabar Hill': 'Grant Road', 'Breach Candy': 'Grant Road', Girgaon: 'Charni Road', Kalbadevi: 'Masjid', Mazgaon: 'Sandhurst Road', Nagpada: 'Mumbai Central',
  Agripada: 'Mumbai Central', Dharavi: 'Sion', 'Antop Hill': 'Wadala Road', 'Naigaon Dadar': 'Dadar',
  Juhu: 'Vile Parle', Versova: 'Andheri', Lokhandwala: 'Andheri', Oshiwara: 'Jogeshwari', Marol: 'Andheri', 'Saki Naka': 'Andheri', Chakala: 'Andheri',
  BKC: 'Bandra', Kalina: 'Santacruz', Aarey: 'Goregaon', Malvani: 'Malad', Charkop: 'Kandivali', Gorai: 'Borivali', Magathane: 'Borivali', Poisar: 'Kandivali',
  'Mith Chowki': 'Malad',
  Powai: 'Kanjurmarg', Chandivali: 'Ghatkopar', Trombay: 'Chembur', Deonar: 'Govandi', 'Anushakti Nagar': 'Mankhurd', Asalpha: 'Ghatkopar', 'Pant Nagar': 'Ghatkopar',
  'Vikhroli Park Site': 'Vikhroli',
  Kashimira: 'Mira Road', Evershine: 'Vasai Road', Tarapur: 'Boisar',
  'Ghodbunder Road': 'Thane', Majiwada: 'Thane', 'Wagle Estate': 'Thane', Kolshet: 'Thane', 'Hiranandani Estate': 'Thane', Kasarvadavali: 'Thane', Manpada: 'Thane',
  'Vartak Nagar': 'Thane', Naupada: 'Thane', Kopri: 'Thane', Balkum: 'Thane', 'Pokhran Road': 'Thane', Kausa: 'Mumbra', 'Shil Phata': 'Mumbra', Owale: 'Thane',
  Brahmand: 'Thane', Patlipada: 'Thane', Louiswadi: 'Thane',
  Bhiwandi: 'Bhiwandi Road', Khadakpada: 'Kalyan', Palava: 'Dombivli', 'Lodha Palava': 'Dombivli', Shahapur: 'Asangaon',
  Mahape: 'Ghansoli', Pawane: 'Turbhe', Ulwe: 'Kharkopar', Kamothe: 'Mansarovar', Taloja: 'Taloja Panchanand', Digha: 'Airoli', 'Ghansoli Gaon': 'Ghansoli',
  'New Panvel': 'Khandeshwar'
};

// Other spellings and old names -> the name used in Guardora.
const ALIASES = {
  CSMT: ['CST', 'VT', 'Chhatrapati Shivaji Maharaj Terminus', 'Chhatrapati Shivaji Terminus', 'Victoria Terminus', 'Mumbai CSMT'],
  Prabhadevi: ['Elphinstone Road', 'Elphinstone'], 'Wadala Road': ['Wadala'], 'Seawoods-Darave': ['Seawoods', 'Darave', 'Seawood'],
  'CBD Belapur': ['Belapur', 'CBD-Belapur', 'C.B.D. Belapur'], 'Vasai Road': ['Vasai'], Bhayandar: ['Bhayander', 'Bhayandar'],
  Kanjurmarg: ['Kanjur Marg', 'Kanjur'], Vidyavihar: ['Vidya Vihar'], Santacruz: ['Santa Cruz'], 'Vile Parle': ['Vileparle', 'Parle'],
  Nalasopara: ['Nala Sopara', 'Nallasopara'], Kandivali: ['Kandivli'], Borivali: ['Borivli'], Dombivli: ['Dombivali'],
  'Kopar Khairane': ['Koparkhairane', 'Kopar Khairne', 'Koparkhairne'], Ambernath: ['Ambarnath'], 'GTB Nagar': ['Guru Tegh Bahadur Nagar'],
  "King's Circle": ['Kings Circle'], 'Khar Road': ['Khar'], 'Mumbai Central': ['Bombay Central'], Sewri: ['Shivdi'], 'Mira Road': ['Mira Bhayandar', 'Mira-Bhayandar'],
  BKC: ['Bandra Kurla Complex', 'Bandra-Kurla Complex'], 'Hiranandani Estate': ['Hiranandani Estates'], 'Ghodbunder Road': ['Ghodbunder', 'G.B. Road', 'GB Road'],
  'Saki Naka': ['Sakinaka'], 'Lower Parel': ['Lower Parel'], 'Hitech City': ['HITEC City', 'Hi-Tech City'], 'Electronic City': ['Electronics City'],
  'Pune Camp': ['Camp Pune'], 'Taloja Panchanand': ['Taloja Panchnand'], 'Nhava Sheva': ['Nhava', 'JNPT'], Kalwa: ['Kalva'], Thakurli: ['Thakurali'],
  Vikhroli: ['Vikroli'], Bhandup: ['Bhandup'], Ghatkopar: ['Ghatkoper'], Chembur: ['Chembur'], Kalyan: ['Kalyan']
};

/* ---------- Derived lookups ---------- */

const INFO = new Map(); // canonical name -> { name, region, city, station, lines: [keys] }
for (const [region, { city, places }] of Object.entries(REGIONS)) {
  for (const name of places) INFO.set(name, { name, region, city: CITY_OF[name] || city, station: NEAR[name] || name, lines: [] });
}
for (const [key, line] of Object.entries(LINES)) {
  for (const branch of line.branches) {
    for (const st of branch) {
      if (!INFO.has(st)) throw new Error('Station without a region: ' + st);
      if (!INFO.get(st).lines.includes(key)) INFO.get(st).lines.push(key);
    }
  }
}
for (const info of INFO.values()) {
  if (info.station !== info.name) info.lines = [...INFO.get(info.station).lines];
}

const ALL_NAMES = [...INFO.keys()];
const MATCH = []; // [written form, canonical]
for (const name of ALL_NAMES) MATCH.push([name, name]);
for (const [name, list] of Object.entries(ALIASES)) for (const a of list) if (a !== name) MATCH.push([a, name]);
MATCH.sort((a, b) => b[0].length - a[0].length);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const AREA_RE = new RegExp('(?<![A-Za-z])(' + MATCH.map(([w]) => escapeRe(w).replace(/[\s-]+/g, '[\\s.-]*')).join('|') + ')(?![A-Za-z])', 'i');
const canonical = (written) => {
  const flat = (s) => s.toLowerCase().replace(/[\s.-]+/g, '');
  const hit = MATCH.find(([w]) => flat(w) === flat(written));
  return hit ? hit[1] : null;
};

/** The first known locality in the text, with its region, city and lines. */
function findArea(text) {
  const m = String(text || '').match(AREA_RE);
  if (!m) return null;
  const name = canonical(m[1]);
  return name ? INFO.get(name) : null;
}

const areaInfo = (name) => INFO.get(name) || INFO.get(canonical(String(name || ''))) || null;

/** Every place on the given lines (stations and the localities around them). */
function placesOnLines(keys) {
  const wanted = new Set(keys.filter((k) => LINES[k]));
  return ALL_NAMES.filter((n) => INFO.get(n).lines.some((l) => wanted.has(l)));
}

/** Places within `stops` stations of `name`, on any line it is on. */
function placesNear(name, stops) {
  const info = areaInfo(name);
  if (!info) return [];
  const stations = new Set([info.station]);
  const n = Math.max(0, Math.min(15, Number(stops) || 0));
  for (const line of Object.values(LINES)) {
    for (const branch of line.branches) {
      const i = branch.indexOf(info.station);
      if (i === -1) continue;
      for (let k = Math.max(0, i - n); k <= Math.min(branch.length - 1, i + n); k++) stations.add(branch[k]);
    }
  }
  return ALL_NAMES.filter((x) => stations.has(INFO.get(x).station));
}

function catalogue() {
  return {
    lines: Object.entries(LINES).map(([key, l]) => ({ key, label: l.label, stations: [...new Set(l.branches.flat())] })),
    regions: Object.entries(REGIONS).map(([name, r]) => ({ name, city: r.city, places: r.places })),
    areas: ALL_NAMES.slice().sort(),
    details: Object.fromEntries(ALL_NAMES.map((n) => { const i = INFO.get(n); return [n, { region: i.region, station: i.station, lines: i.lines }]; }))
  };
}

module.exports = { findArea, areaInfo, placesOnLines, placesNear, catalogue, LINES };
