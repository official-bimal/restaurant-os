import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

/**
 * One-off: puts the Nerro Cafe opening menu (from the handwritten menu card) into the demo business and renames it.
 * Safe to run again: dishes are matched by name and updated, never doubled. Dishes that are not on the card are switched off
 * (not deleted: old bills still point at them). Run with the app stopped (the dev database takes one connection):
 *   npx tsx scripts/import-nerro-menu.ts
 * Where the card gives two prices for one name (Single/Double, Hot/Cold), each is its own dish so it can be picked and billed on its own.
 */

type Row = [name: string, rupees: number];
interface Section {
  category: string;
  station: "Bar" | "Kitchen";
  prepMinutes: number;
  items: Row[];
}

const MENU: Section[] = [
  {
    category: "Hot Coffee", station: "Bar", prepMinutes: 5,
    items: [["Espresso", 130], ["Doppio", 140], ["Lungo", 160], ["Americano (Single)", 140], ["Americano (Double)", 170], ["Cappuccino", 180], ["Flat White", 190], ["Cafe Latte", 200], ["Vanilla Latte", 210], ["Honey Latte", 210], ["Spanish Latte", 210], ["Affogato", 190], ["Cafe Mocha", 240], ["Cafe Con Miel", 180]],
  },
  {
    category: "Iced Coffee", station: "Bar", prepMinutes: 6,
    items: [["Iced Americano", 210], ["Iced Cappuccino", 220], ["Iced Latte", 230], ["Iced Mocha", 260], ["Iced Honey Latte", 240], ["Iced Vanilla Latte", 240], ["Iced Spanish Latte", 240], ["Iced Caramel Macchiato", 230]],
  },
  {
    category: "Coffee Alternative", station: "Bar", prepMinutes: 6,
    items: [["Hot Chocolate", 200], ["Cold Chocolate", 220], ["Hot Lemon Ginger Honey", 150], ["Hot Lemon Honey", 120], ["Virgin Mojito", 210], ["Strawberry Mojito", 250], ["Blueberry Mojito", 260], ["Peach Iced Tea", 200], ["Lemon Iced Tea", 200], ["Mint Lemonade", 200], ["Lemonade", 180], ["Watermelon Juice", 200], ["Coke", 70], ["Sprite", 70], ["Lemon Water", 70]],
  },
  { category: "Tea", station: "Bar", prepMinutes: 4, items: [["Black Tea", 50], ["Milk Tea", 70], ["Masala Tea", 90], ["Green Tea", 100], ["Ginger Tea", 60], ["Lemon Tea", 60]] },
  { category: "Smoothie", station: "Bar", prepMinutes: 6, items: [["Strawberry Smoothie", 250], ["Blueberry Smoothie", 280], ["Kiwi Smoothie", 220], ["Mango Smoothie", 220]] },
  { category: "Lassi", station: "Bar", prepMinutes: 4, items: [["Plain Lassi", 150], ["Banana Lassi", 200]] },
  { category: "Shake", station: "Bar", prepMinutes: 6, items: [["Oreo Shake", 260], ["Kitkat Shake", 280]] },
  {
    category: "Matcha", station: "Bar", prepMinutes: 6,
    items: [["Hot Matcha Latte", 250], ["Iced Matcha Latte", 280], ["Strawberry Iced Matcha", 300], ["Blueberry Iced Matcha", 300], ["Kiwi Iced Matcha", 300], ["Mango Iced Matcha", 300]],
  },
  { category: "Food Item", station: "Kitchen", prepMinutes: 15, items: [["Chicken Momo", 180], ["French Fry", 210]] },
  { category: "Noodles", station: "Kitchen", prepMinutes: 12, items: [["Buldak", 380], ["Shin Ramen", 280], ["Current", 120], ["Chau Chau Sadeko", 200]] },
  {
    category: "Extra Topping", station: "Kitchen", prepMinutes: 8,
    items: [["Sausage (Fried)", 90], ["Sausage (Boiled)", 80], ["Egg (Boiled)", 50], ["Egg (Fried)", 60], ["Egg (Sunny Side)", 70]],
  },
  { category: "Hukka (Shisha)", station: "Bar", prepMinutes: 10, items: [["Hukka Mint", 500], ["Hukka Love-66", 600], ["Hukka Lady Killer", 550], ["Hukka Astro Love", 550], ["Extra Coil", 50]] },
  { category: "Cigarette", station: "Bar", prepMinutes: 1, items: [["Surya Red", 30], ["Surya Lite", 30], ["Shikhar Ice", 25]] },
];

async function main() {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const biz = (await db.business.findFirst({ where: { name: { in: ["Demo Cafe", "Nerro Cafe"] } } })) ?? (await db.business.findFirstOrThrow());
    const businessId = biz.id;
    await db.business.update({ where: { id: businessId }, data: { name: "Nerro Cafe" } });

    const stations = new Map<string, string>();
    for (const name of ["Bar", "Kitchen"]) {
      const s = (await db.station.findFirst({ where: { businessId, name } })) ?? (await db.station.create({ data: { businessId, name } }));
      stations.set(name, s.id);
    }

    const existing = await db.menuItem.findMany({ where: { businessId }, select: { id: true, name: true } });
    const byName = new Map(existing.map((i) => [i.name.toLowerCase(), i.id]));
    const onCard = new Set<string>();
    let created = 0;
    let updated = 0;
    let order = (await db.menuCategory.aggregate({ where: { businessId }, _max: { sortOrder: true } }))._max.sortOrder ?? 0;

    for (const section of MENU) {
      const category =
        (await db.menuCategory.findFirst({ where: { businessId, name: section.category } })) ??
        (await db.menuCategory.create({ data: { businessId, name: section.category, sortOrder: ++order } }));
      for (const [name, rupees] of section.items) {
        const data = { categoryId: category.id, stationId: stations.get(section.station)!, name, price: rupees * 100, prepMinutes: section.prepMinutes, available: true };
        const id = byName.get(name.toLowerCase());
        if (id) {
          await db.menuItem.update({ where: { businessId_id: { businessId, id } }, data });
          onCard.add(id);
          updated++;
        } else {
          const made = await db.menuItem.create({ data: { businessId, ...data } });
          onCard.add(made.id);
          byName.set(name.toLowerCase(), made.id);
          created++;
        }
      }
    }

    const off = await db.menuItem.updateMany({ where: { businessId, id: { notIn: [...onCard] }, available: true }, data: { available: false } });
    console.log(`Business renamed to "Nerro Cafe". Dishes: ${created} added, ${updated} updated, ${off.count} not on the card switched off.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
