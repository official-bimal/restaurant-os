import "dotenv/config";
import { hash } from "@node-rs/argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

// Development-only demo data. Never run against a real tenant.
const DEMO_EMAIL = "owner@demo.test";
const DEMO_PASSWORD = "demo-owner-change-me";

const rs = (n: number) => n * 100; // rupees -> paisa

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  if ((await prisma.business.count()) > 0) {
    console.log("Database already has data; seed skipped.");
    return prisma.$disconnect();
  }

  const user = await prisma.user.create({
    data: { email: DEMO_EMAIL, name: "Demo Owner", passwordHash: await hash(DEMO_PASSWORD) },
  });

  const business = await prisma.business.create({
    data: {
      name: "Demo Cafe",
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  const businessId = business.id;
  const branch = await prisma.branch.create({ data: { businessId, name: "Main branch" } });
  const branchId = branch.id;

  const kitchen = await prisma.station.create({ data: { businessId, name: "Kitchen" } });
  const bar = await prisma.station.create({ data: { businessId, name: "Bar" } });

  const ground = await prisma.area.create({ data: { businessId, branchId, name: "Ground floor" } });
  const terrace = await prisma.area.create({ data: { businessId, branchId, name: "Terrace", sortOrder: 1 } });
  await prisma.diningTable.createMany({
    data: [
      ...[1, 2, 3, 4].map((n) => ({ businessId, branchId, areaId: ground.id, label: `T${n}`, capacity: 4 })),
      ...[5, 6].map((n) => ({ businessId, branchId, areaId: terrace.id, label: `T${n}`, capacity: 2 })),
    ],
  });

  const catalogue: Record<string, { stationId: string; items: [string, number, number][] }> = {
    Coffee: { stationId: bar.id, items: [["Espresso", 150, 4], ["Cappuccino", 220, 6], ["Iced Latte", 260, 6]] },
    Snacks: { stationId: kitchen.id, items: [["Veg Momo", 200, 15], ["Chicken Burger", 350, 18], ["French Fries", 180, 10]] },
    Mains: { stationId: kitchen.id, items: [["Thukpa", 280, 15], ["Fried Rice", 300, 15]] },
  };
  let order = 0;
  for (const [name, { stationId, items }] of Object.entries(catalogue)) {
    const category = await prisma.menuCategory.create({ data: { businessId, name, sortOrder: order++ } });
    await prisma.menuItem.createMany({
      data: items.map(([itemName, price, prepMinutes]) => ({
        businessId, categoryId: category.id, stationId, name: itemName, price: rs(price), prepMinutes,
      })),
    });
  }

  console.log(`Seeded "${business.name}". Sign-in: ${DEMO_EMAIL} (password in prisma/seed.ts).`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
