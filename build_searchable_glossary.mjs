import { execFileSync } from "node:child_process";
import fs from "node:fs";

const textsPath = "content/i18n/en-US/texts.json";
const outputPath = "content/i18n/en-US/glossary.json";
const texts = JSON.parse(fs.readFileSync(textsPath, "utf8"));
const originalGlossary = JSON.parse(execFileSync(
  "git",
  ["show", "d83d1b2^:content/i18n/en-US/glossary.json"],
  { encoding: "utf8", maxBuffer: 10_000_000 },
));

const lessonText = Object.entries(texts)
  // Printed pages 1-96 contain lessons. Page 97 is the four-term source
  // glossary and page 98 is the bibliography, so neither should generate
  // extra searchable matches.
  .filter(([key]) => /^pg(?:00[7-9]|0[1-9][0-9]|10[0-2])_/.test(key) || key.startsWith("qz"))
  .map(([, value]) => String(value))
  .join("\n");

const excludedIds = new Set([
  // Duplicate concepts. The retained entry owns both singular and plural forms.
  "gl046", // communities -> community
  "gl061", // creating -> create
  "gl071", // differences -> difference
  "gl113", // grilled -> grilled meat
  "gl140", // knees -> knee
  "gl196", // pupils -> pupil
  "gl208", // requirement -> requirements
  "gl260", // water colour -> water colours
]);

const alwaysInclude = new Set([
  "sports",
]);

const legacyEntryFor = {
  njuga: "ankle bells",
  spices: "condiments",
  baragumu: "horn",
  kayamba: "shaker",
};

const safeVariationOverrides = {
  art: ["art", "arts"],
  artwork: ["artwork", "artworks"],
  baragumu: ["baragumu"],
  colouring: ["colouring", "coloring"],
  community: ["community", "communities"],
  create: ["create", "creates", "created", "creating"],
  difference: ["difference", "differences", "different"],
  edible: ["edible"],
  empty: ["empty"],
  knee: ["knee", "knees"],
  kayamba: ["kayamba"],
  njuga: ["njuga"],
  pupil: ["pupil", "pupils"],
  requirements: ["requirement", "requirements"],
  shorts: ["shorts"],
  spices: ["spice", "spices"],
  "tree bark": ["tree bark"],
  "water colours": ["water colour", "water colours", "watercolor", "watercolors"],
  winner: ["winner", "winners"],
};

const fallbackEmoji = {
  njuga: "🔔🦶",
  spices: "🌿🍲",
  baragumu: "📯",
  kayamba: "🪇",
};

// These are source-book pictures whose descriptions explicitly teach the term.
// The runtime loads them lazily only when that glossary definition is opened.
const imageTextIds = {
  njuga: "pg016_im002",
  bananas: "pg012_im001",
  basket: "pg101_im002",
  batik: "pg014_im001",
  beads: "pg050_im003_seg001_v1_crop_v1",
  blouse: "pg013_im002",
  brush: "pg040_im001",
  bucket: "pg035_im003",
  church: "pg023_im001",
  clay: "pg035_im002",
  crayons: "pg039_im006",
  cup: "pg037_im001",
  dance: "pg018_im002",
  dress: "pg013_im003",
  drum: "pg017_im001",
  exercise: "pg063_im001",
  fish: "pg008_im001",
  flute: "pg017_im002_seg002_v1_crop_v1",
  greens: "pg009_im002",
  "grilled meat": "pg012_im003",
  handstand: "pg088_im001",
  hopscotch: "pg084_im002",
  hurdles: "pg075_im002",
  "human figure": "pg036_im008",
  jacks: "pg070_im004",
  kanga: "pg013_im002",
  kaniki: "pg015_im001",
  kitenge: "pg013_im003",
  kayamba: "pg017_im003",
  lubega: "pg014_im004_crop_v1",
  marble: "pg071_im001",
  mat: "pg034_im002",
  meat: "pg012_im003",
  mosque: "pg022_im002",
  msuli: "pg014_im003",
  pencil: "pg039_im002",
  rattle: "pg017_im006",
  referee: "pg099_im002",
  rice: "pg007_im001",
  rope: "pg094_im002",
  rubber: "pg039_im005",
  sharpener: "pg039_im003",
  shorts: "pg014_im002",
  somersault: "pg090_im005",
  "T-shirt": "pg014_im002",
  texture: "pg046_im003",
  tile: "pg084_im002",
  tortoise: "pg076_im011",
  "tree bark": "pg045_im002_seg004_v1",
  ugali: "pg007_im003",
  vegetables: "pg012_im002",
  weaving: "pg034_im002",
  whistle: "pg074_im002",
  xylophone: "pg017_im005",
  baragumu: "pg017_im004",
};

const sourceForImageId = new Map();
for (const file of fs.readdirSync(".").filter((name) => /^pg.*\.html$/.test(name))) {
  const html = fs.readFileSync(file, "utf8");
  for (const match of html.matchAll(/(<img\b[^>]*>)[\s\S]{0,500}?<span\b[^>]*data-id=["']([^"']+)["'][^>]*>/gi)) {
    const source = match[1].match(/src=["']([^"']+)["']/i)?.[1];
    if (source) sourceForImageId.set(match[2], source);
  }
}

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const occursInLesson = (value) => new RegExp(
  `(?<![A-Za-z])${escapeRegex(value)}(?![A-Za-z])`,
  "i",
).test(lessonText);

const sourceRows = Object.entries(texts)
  .filter(([key]) => /^gl\d{3}$/.test(key) && !excludedIds.has(key))
  .map(([id, word]) => {
    const legacyKey = legacyEntryFor[word] || word;
    const legacy = originalGlossary[legacyKey];
    const proposedVariations = safeVariationOverrides[word] || legacy?.variations || [word];
    const matchingVariations = proposedVariations.filter(occursInLesson);
    return {
      id,
      word,
      definition: texts[`${id}_def`],
      emoji: fallbackEmoji[word] || legacy?.emoji || "",
      proposedVariations,
      matchingVariations,
    };
  })
  .filter((entry) => entry.matchingVariations.length || occursInLesson(entry.word) || alwaysInclude.has(entry.word));

const canonicalWords = new Set(sourceRows.map((entry) => entry.word.toLowerCase()));
const claimedVariations = new Set();
const glossary = {};

for (const entry of sourceRows) {
  const variations = [];
  const candidates = [entry.word, ...entry.proposedVariations];
  for (const variation of candidates) {
    const normalized = variation.toLowerCase();
    const belongsToAnotherCanonical = canonicalWords.has(normalized) && normalized !== entry.word.toLowerCase();
    if (belongsToAnotherCanonical || claimedVariations.has(normalized)) continue;
    if (variation !== entry.word && !occursInLesson(variation)) continue;
    variations.push(variation);
    claimedVariations.add(normalized);
  }

  const item = {
    word: entry.word,
    definition: entry.definition,
    variations,
    emoji: entry.emoji,
    textId: entry.id,
    definitionId: `${entry.id}_def`,
  };

  const imageTextId = imageTextIds[entry.word];
  if (imageTextId) {
    const image = sourceForImageId.get(imageTextId);
    const imageAlt = texts[imageTextId];
    if (!image || !imageAlt) throw new Error(`Missing glossary visual for ${entry.word}: ${imageTextId}`);
    if (!fs.existsSync(image)) throw new Error(`Missing glossary image file: ${image}`);
    item.image = image;
    item.imageAlt = imageAlt;
    item.imageTextId = imageTextId;
  }

  glossary[entry.word] = item;
}

fs.writeFileSync(outputPath, `${JSON.stringify(glossary, null, 2)}\n`);
console.log(`Wrote ${Object.keys(glossary).length} lesson-aligned glossary entries to ${outputPath}.`);
console.log(`${Object.values(glossary).filter((entry) => entry.image).length} entries include source-book visuals.`);
