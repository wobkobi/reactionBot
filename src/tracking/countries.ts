// src/tracking/countries.ts

// Reacts to country names with that country's flag. Built in rather than kept
// in words.json: the table is the same for every server and too long to ask
// anyone to maintain by hand.

import { compileItems, DetectList, findMatches } from "@/tracking/detect";

/** Most flags one message gets, so a list of countries can't flood it. */
export const MAX_FLAGS = 10;

/**
 * Builds a flag emoji from an ISO 3166-1 alpha-2 code: each letter becomes
 * its regional indicator, and Discord renders the pair as the flag.
 * @param code - Two letters, e.g. "NZ".
 * @returns The flag emoji, e.g. "🇳🇿".
 */
export function flagFor(code: string): string {
  return [...code.toUpperCase()]
    .map((c) => String.fromCodePoint(0x1f1a5 + c.charCodeAt(0)))
    .join("");
}

// The UK nations have flags of their own, built as tag sequences rather than
// regional-indicator pairs.
const ENGLAND = "🏴󠁧󠁢󠁥󠁮󠁧󠁿";
const SCOTLAND = "🏴󠁧󠁢󠁳󠁣󠁴󠁿";
const WALES = "🏴󠁧󠁢󠁷󠁬󠁳󠁿";

/**
 * Country names and common aliases per flag: an ISO code, or one of the UK
 * nation flags. Left out on purpose, because the plain word usually means
 * something else in chat: Chad, Jordan and Georgia (names, a US state),
 * Jersey (clothing), Guinea (guinea pig; the longer Guinea names are listed),
 * and "us" (the pronoun; "usa" is listed). Demonyms are left out too, since
 * "french fries" and "english" the language are not about the country.
 */
const COUNTRIES: Array<[string, string[]]> = [
  ["AF", ["afghanistan"]],
  ["AL", ["albania"]],
  ["DZ", ["algeria"]],
  ["AD", ["andorra"]],
  ["AO", ["angola"]],
  ["AG", ["antigua and barbuda", "antigua"]],
  ["AR", ["argentina"]],
  ["AM", ["armenia"]],
  ["AU", ["australia"]],
  ["AT", ["austria"]],
  ["AZ", ["azerbaijan"]],
  ["BS", ["bahamas"]],
  ["BH", ["bahrain"]],
  ["BD", ["bangladesh"]],
  ["BB", ["barbados"]],
  ["BY", ["belarus"]],
  ["BE", ["belgium"]],
  ["BZ", ["belize"]],
  ["BJ", ["benin"]],
  ["BT", ["bhutan"]],
  ["BO", ["bolivia"]],
  ["BA", ["bosnia and herzegovina", "bosnia"]],
  ["BW", ["botswana"]],
  ["BR", ["brazil", "brasil"]],
  ["BN", ["brunei"]],
  ["BG", ["bulgaria"]],
  ["BF", ["burkina faso"]],
  ["BI", ["burundi"]],
  ["CV", ["cape verde", "cabo verde"]],
  ["KH", ["cambodia"]],
  ["CM", ["cameroon"]],
  ["CA", ["canada"]],
  ["CF", ["central african republic"]],
  ["CL", ["chile"]],
  ["CN", ["china"]],
  ["CO", ["colombia"]],
  ["KM", ["comoros"]],
  ["CG", ["congo", "republic of the congo"]],
  ["CD", ["democratic republic of the congo", "drc"]],
  ["CR", ["costa rica"]],
  ["CI", ["ivory coast", "cote divoire"]],
  ["HR", ["croatia"]],
  ["CU", ["cuba"]],
  ["CY", ["cyprus"]],
  ["CZ", ["czechia", "czech republic"]],
  ["DK", ["denmark"]],
  ["DJ", ["djibouti"]],
  ["DM", ["dominica"]],
  ["DO", ["dominican republic"]],
  ["EC", ["ecuador"]],
  ["EG", ["egypt"]],
  ["SV", ["el salvador"]],
  ["GQ", ["equatorial guinea"]],
  ["ER", ["eritrea"]],
  ["EE", ["estonia"]],
  ["SZ", ["eswatini", "swaziland"]],
  ["ET", ["ethiopia"]],
  ["FJ", ["fiji"]],
  ["FI", ["finland"]],
  ["FR", ["france"]],
  ["GA", ["gabon"]],
  ["GM", ["gambia"]],
  ["DE", ["germany"]],
  ["GH", ["ghana"]],
  ["GR", ["greece"]],
  ["GD", ["grenada"]],
  ["GT", ["guatemala"]],
  ["GW", ["guinea bissau"]],
  ["GY", ["guyana"]],
  ["HT", ["haiti"]],
  ["HN", ["honduras"]],
  ["HU", ["hungary"]],
  ["IS", ["iceland"]],
  ["IN", ["india"]],
  ["ID", ["indonesia"]],
  ["IR", ["iran"]],
  ["IQ", ["iraq"]],
  ["IE", ["ireland"]],
  ["IL", ["israel"]],
  ["IT", ["italy"]],
  ["JM", ["jamaica"]],
  ["JP", ["japan"]],
  ["KZ", ["kazakhstan"]],
  ["KE", ["kenya"]],
  ["KI", ["kiribati"]],
  ["KP", ["north korea"]],
  ["KR", ["south korea", "korea"]],
  ["XK", ["kosovo"]],
  ["KW", ["kuwait"]],
  ["KG", ["kyrgyzstan"]],
  ["LA", ["laos"]],
  ["LV", ["latvia"]],
  ["LB", ["lebanon"]],
  ["LS", ["lesotho"]],
  ["LR", ["liberia"]],
  ["LY", ["libya"]],
  ["LI", ["liechtenstein"]],
  ["LT", ["lithuania"]],
  ["LU", ["luxembourg"]],
  ["MG", ["madagascar"]],
  ["MW", ["malawi"]],
  ["MY", ["malaysia"]],
  ["MV", ["maldives"]],
  ["ML", ["mali"]],
  ["MT", ["malta"]],
  ["MH", ["marshall islands"]],
  ["MR", ["mauritania"]],
  ["MU", ["mauritius"]],
  ["MX", ["mexico"]],
  ["FM", ["micronesia"]],
  ["MD", ["moldova"]],
  ["MC", ["monaco"]],
  ["MN", ["mongolia"]],
  ["ME", ["montenegro"]],
  ["MA", ["morocco"]],
  ["MZ", ["mozambique"]],
  ["MM", ["myanmar", "burma"]],
  ["NA", ["namibia"]],
  ["NR", ["nauru"]],
  ["NP", ["nepal"]],
  ["NL", ["netherlands", "holland"]],
  ["NZ", ["new zealand", "aotearoa", "nz"]],
  ["NI", ["nicaragua"]],
  ["NE", ["niger"]],
  ["NG", ["nigeria"]],
  ["MK", ["north macedonia", "macedonia"]],
  ["NO", ["norway"]],
  ["OM", ["oman"]],
  ["PK", ["pakistan"]],
  ["PW", ["palau"]],
  ["PS", ["palestine"]],
  ["PA", ["panama"]],
  ["PG", ["papua new guinea"]],
  ["PY", ["paraguay"]],
  ["PE", ["peru"]],
  ["PH", ["philippines"]],
  ["PL", ["poland"]],
  ["PT", ["portugal"]],
  ["QA", ["qatar"]],
  ["RO", ["romania"]],
  ["RU", ["russia"]],
  ["RW", ["rwanda"]],
  ["KN", ["saint kitts and nevis", "st kitts"]],
  ["LC", ["saint lucia", "st lucia"]],
  ["VC", ["saint vincent and the grenadines", "st vincent"]],
  ["WS", ["samoa"]],
  ["SM", ["san marino"]],
  ["ST", ["sao tome and principe"]],
  ["SA", ["saudi arabia", "saudi"]],
  ["SN", ["senegal"]],
  ["RS", ["serbia"]],
  ["SC", ["seychelles"]],
  ["SL", ["sierra leone"]],
  ["SG", ["singapore"]],
  ["SK", ["slovakia"]],
  ["SI", ["slovenia"]],
  ["SB", ["solomon islands"]],
  ["SO", ["somalia"]],
  ["ZA", ["south africa"]],
  ["SS", ["south sudan"]],
  ["ES", ["spain"]],
  ["LK", ["sri lanka"]],
  ["SD", ["sudan"]],
  ["SR", ["suriname"]],
  ["SE", ["sweden"]],
  ["CH", ["switzerland"]],
  ["SY", ["syria"]],
  ["TW", ["taiwan"]],
  ["TJ", ["tajikistan"]],
  ["TZ", ["tanzania"]],
  ["TH", ["thailand"]],
  ["TL", ["timor leste", "east timor"]],
  ["TG", ["togo"]],
  ["TO", ["tonga"]],
  ["TT", ["trinidad and tobago", "trinidad"]],
  ["TN", ["tunisia"]],
  ["TR", ["turkey", "turkiye"]],
  ["TM", ["turkmenistan"]],
  ["TV", ["tuvalu"]],
  ["UG", ["uganda"]],
  ["UA", ["ukraine"]],
  ["AE", ["united arab emirates", "uae", "dubai"]],
  ["GB", ["united kingdom", "uk", "great britain", "britain", "northern ireland"]],
  ["US", ["united states of america", "united states", "usa", "u s a", "america"]],
  ["UY", ["uruguay"]],
  ["UZ", ["uzbekistan"]],
  ["VU", ["vanuatu"]],
  ["VA", ["vatican", "vatican city"]],
  ["VE", ["venezuela"]],
  ["VN", ["vietnam", "viet nam"]],
  ["YE", ["yemen"]],
  ["ZM", ["zambia"]],
  ["ZW", ["zimbabwe"]],
  // Territories with a flag emoji that come up often enough to list
  ["HK", ["hong kong"]],
  ["MO", ["macau", "macao"]],
  ["PR", ["puerto rico"]],
  ["GL", ["greenland"]],
  ["CK", ["cook islands"]],
  ["NC", ["new caledonia"]],
  ["AQ", ["antarctica"]],
  [ENGLAND, ["england"]],
  [SCOTLAND, ["scotland"]],
  [WALES, ["wales"]],
];

/**
 * Phrases that contain a country name without meaning the country. They match
 * no flag, and because the matcher tries longer phrases first they swallow
 * the name inside them ("south america" never reaches "america").
 */
const NOT_COUNTRIES = [
  "south america",
  "north america",
  "central america",
  "latin america",
  "new mexico",
  "new england",
  "new south wales",
  "turkey sandwich",
  "fine china",
];

/** Normalised name > flag, and the compiled matcher over every name. */
let compiled: { flags: Map<string, string | null>; list: DetectList } | null = null;

/**
 * Builds the name lookup and matcher on first use.
 * @returns The flag per normalised name, and the list to match against.
 */
function table(): { flags: Map<string, string | null>; list: DetectList } {
  if (compiled) return compiled;
  const flags = new Map<string, string | null>();
  for (const [code, names] of COUNTRIES) {
    const flag = code.length === 2 ? flagFor(code) : code;
    for (const name of names) flags.set(name, flag);
  }
  for (const phrase of NOT_COUNTRIES) flags.set(phrase, null);
  compiled = { flags, list: compileItems([...flags.keys()].map((word) => ({ word }))) };
  return compiled;
}

/**
 * The flags for every country a message names, in the order they first
 * appear, each once, capped at {@link MAX_FLAGS}.
 * @param content - Raw message content.
 * @returns Flag emojis to react with.
 */
export function countryFlags(content: string): string[] {
  const { flags, list } = table();
  const out: string[] = [];
  const hits = findMatches(content, list).sort((a, b) => a.before - b.before);
  for (const hit of hits) {
    const flag = flags.get(hit.word);
    if (flag && !out.includes(flag)) out.push(flag);
    if (out.length === MAX_FLAGS) break;
  }
  return out;
}
