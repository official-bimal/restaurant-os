import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

/**
 * One-off: gives the Nerro Cafe dishes and categories their Nepali names, shown to guests who pick Nepali on the table menu.
 * Matched by English name; safe to run again. A person who reads Nepali should look them over: they are plain translations and
 * spellings of the usual café words, and any can be changed on the Menu page.
 *   npx tsx scripts/nerro-nepali-names.ts      (with the app stopped)
 */

const CATEGORIES: Record<string, string> = {
  "Hot Coffee": "तातो कफी",
  "Iced Coffee": "आइस्ड कफी",
  "Coffee Alternative": "कफी विकल्प",
  Tea: "चिया",
  Smoothie: "स्मुदी",
  Lassi: "लस्सी",
  Shake: "शेक",
  Matcha: "माचा",
  "Food Item": "खाना",
  Noodles: "नुडल्स",
  "Extra Topping": "थप टपिङ",
  "Hukka (Shisha)": "हुक्का (शीशा)",
  Cigarette: "चुरोट",
};

const DISHES: Record<string, string> = {
  Espresso: "एस्प्रेसो",
  Doppio: "डप्पियो",
  Lungo: "लुङ्गो",
  "Americano (Single)": "अमेरिकानो (सिंगल)",
  "Americano (Double)": "अमेरिकानो (डबल)",
  Cappuccino: "क्यापुचिनो",
  "Flat White": "फ्ल्याट ह्वाइट",
  "Cafe Latte": "क्याफे ल्याटे",
  "Vanilla Latte": "भ्यानिला ल्याटे",
  "Honey Latte": "हनी ल्याटे",
  "Spanish Latte": "स्पेनिस ल्याटे",
  Affogato: "अफोगातो",
  "Cafe Mocha": "क्याफे मोचा",
  "Cafe Con Miel": "क्याफे कोन मिएल",
  "Iced Americano": "आइस्ड अमेरिकानो",
  "Iced Cappuccino": "आइस्ड क्यापुचिनो",
  "Iced Latte": "आइस्ड ल्याटे",
  "Iced Mocha": "आइस्ड मोचा",
  "Iced Honey Latte": "आइस्ड हनी ल्याटे",
  "Iced Vanilla Latte": "आइस्ड भ्यानिला ल्याटे",
  "Iced Spanish Latte": "आइस्ड स्पेनिस ल्याटे",
  "Iced Caramel Macchiato": "आइस्ड क्यारामेल माकियातो",
  "Hot Chocolate": "तातो चकलेट",
  "Cold Chocolate": "चिसो चकलेट",
  "Hot Lemon Ginger Honey": "तातो कागती अदुवा मह",
  "Hot Lemon Honey": "तातो कागती मह",
  "Virgin Mojito": "भर्जिन मोहितो",
  "Strawberry Mojito": "स्ट्रबेरी मोहितो",
  "Blueberry Mojito": "ब्लुबेरी मोहितो",
  "Peach Iced Tea": "पिच आइस्ड टी",
  "Lemon Iced Tea": "लेमन आइस्ड टी",
  "Mint Lemonade": "पुदिना लेमोनेड",
  Lemonade: "लेमोनेड",
  "Watermelon Juice": "तरबुजाको जुस",
  Coke: "कोक",
  Sprite: "स्प्राइट",
  "Lemon Water": "कागतीको पानी",
  "Black Tea": "कालो चिया",
  "Milk Tea": "दूध चिया",
  "Masala Tea": "मसला चिया",
  "Green Tea": "ग्रिन टी",
  "Ginger Tea": "अदुवा चिया",
  "Lemon Tea": "कागती चिया",
  "Strawberry Smoothie": "स्ट्रबेरी स्मुदी",
  "Blueberry Smoothie": "ब्लुबेरी स्मुदी",
  "Kiwi Smoothie": "कीवी स्मुदी",
  "Mango Smoothie": "आँप स्मुदी",
  "Plain Lassi": "सादा लस्सी",
  "Banana Lassi": "केरा लस्सी",
  "Oreo Shake": "ओरियो शेक",
  "Kitkat Shake": "किटक्याट शेक",
  "Hot Matcha Latte": "तातो माचा ल्याटे",
  "Iced Matcha Latte": "आइस्ड माचा ल्याटे",
  "Strawberry Iced Matcha": "स्ट्रबेरी आइस्ड माचा",
  "Blueberry Iced Matcha": "ब्लुबेरी आइस्ड माचा",
  "Kiwi Iced Matcha": "कीवी आइस्ड माचा",
  "Mango Iced Matcha": "आँप आइस्ड माचा",
  "Chicken Momo": "चिकेन मोमो",
  "French Fry": "फ्रेन्च फ्राई",
  Buldak: "बुल्डक",
  "Shin Ramen": "सिन रामेन",
  Current: "करेन्ट",
  "Chau Chau Sadeko": "चाउचाउ सदेको",
  "Sausage (Fried)": "सुसेज (फ्राइ)",
  "Sausage (Boiled)": "सुसेज (उमालेको)",
  "Egg (Boiled)": "अण्डा (उमालेको)",
  "Egg (Fried)": "अण्डा (फ्राइ)",
  "Egg (Sunny Side)": "अण्डा (सनी साइड)",
  "Hukka Mint": "हुक्का पुदिना",
  "Hukka Love-66": "हुक्का लभ-६६",
  "Hukka Lady Killer": "हुक्का लेडी किलर",
  "Hukka Astro Love": "हुक्का एस्ट्रो लभ",
  "Extra Coil": "थप कोइला",
  "Surya Red": "सूर्य रेड",
  "Surya Lite": "सूर्य लाइट",
  "Shikhar Ice": "शिखर आइस",
};

async function main() {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const biz = await db.business.findFirstOrThrow({ where: { name: "Nerro Cafe" } });
    let cats = 0;
    let dishes = 0;
    for (const [name, nameNe] of Object.entries(CATEGORIES)) cats += (await db.menuCategory.updateMany({ where: { businessId: biz.id, name }, data: { nameNe } })).count;
    for (const [name, nameNe] of Object.entries(DISHES)) dishes += (await db.menuItem.updateMany({ where: { businessId: biz.id, name }, data: { nameNe } })).count;
    console.log(`Nepali names set on ${cats} categories and ${dishes} dishes.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
