import Link from "next/link";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { Icon } from "@/components/icons";

export const metadata: Metadata = {
  title: `${BRAND.name} | Restaurant and cafe software for Nepal`,
  description: "Orders, kitchen, billing, stock, delivery and staff in one system. Guests order from their phone by scanning the table QR code. Built for cafes and restaurants in Nepal.",
};

const FEATURES = [
  { icon: "orders", tone: "bg-blue-100 text-blue-600", title: "Orders, table to kitchen", text: "Dine in, takeaway and delivery on one screen. Orders reach the kitchen display the moment they are taken, and every page updates by itself." },
  { icon: "tables", tone: "bg-violet-100 text-violet-600", title: "QR table ordering", text: "Guests scan the code on the table, browse a clean menu in English or Nepali, and send the order from their phone. Staff accept it in one tap." },
  { icon: "bills", tone: "bg-emerald-100 text-emerald-600", title: "Billing that adds up", text: "Discounts, service charge, VAT, split and merged bills, part refunds with credit notes, and receipts you can print on 80 mm paper." },
  { icon: "stock", tone: "bg-amber-100 text-amber-600", title: "Stock and recipes", text: "Know what a dish costs, see stock fall as you sell, get low-stock alerts, order from suppliers and track what you owe them." },
  { icon: "truck", tone: "bg-orange-100 text-orange-600", title: "Delivery and riders", text: "Fees by distance, rider accounts, a live map, runs with several stops, and cash hand-ins tracked to the paisa." },
  { icon: "customers", tone: "bg-pink-100 text-pink-600", title: "Loyalty and campaigns", text: "Points that earn and spend themselves, birthday and win-back messages, and a record of who came back because of them." },
  { icon: "reports", tone: "bg-teal-100 text-teal-600", title: "Reports you trust", text: "Daily sales, day close with cash count, best sellers, food cost, and a combined view across all your branches." },
  { icon: "clock", tone: "bg-slate-200 text-slate-600", title: "Staff and attendance", text: "Staff clock in at the cafe from their phone, you get told when they arrive and leave, and hours turn into payroll at month end." },
];

const STEPS = [
  { n: "1", title: "Set up your menu", text: "Add your categories, dishes, prices and kitchen stations. Add Nepali names and photos if you like." },
  { n: "2", title: "Print your table codes", text: "Each table gets its own QR code. Guests scan it with the phone camera. No app to install." },
  { n: "3", title: "Run the day", text: "Orders flow to the kitchen, bills close in seconds, and you see the numbers as the day goes." },
];

export default async function LandingPage() {
  const signedIn = (await cookies()).has("ros_session");
  const cta = signedIn ? { href: "/dashboard", label: "Open your dashboard" } : { href: "/login", label: "Sign in" };

  return (
    <div className="bg-white text-stone-900">
      {/* top bar */}
      <header className="sticky top-0 z-30 border-b border-stone-200/70 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-brand-600 text-sm font-bold text-white">{BRAND.initial}</span>
            <span className="whitespace-nowrap text-base font-semibold tracking-tight">{BRAND.name}</span>
          </Link>
          <nav aria-label="Sections" className="ml-6 hidden gap-6 text-sm font-medium text-stone-600 md:flex">
            <a href="#features" className="hover:text-stone-900">Features</a>
            <a href="#guests" className="hover:text-stone-900">For guests</a>
            <a href="#staff" className="hover:text-stone-900">For staff</a>
            <a href="#how" className="hover:text-stone-900">How it works</a>
          </nav>
          <div className="ml-auto">
            <Link href={cta.href} className="btn-primary whitespace-nowrap">
              {signedIn ? (
                <>
                  <span className="sm:hidden">Dashboard</span>
                  <span className="hidden sm:inline">{cta.label}</span>
                </>
              ) : (
                cta.label
              )}
            </Link>
          </div>
        </div>
      </header>

      {/* hero */}
      <section className="relative overflow-hidden bg-[radial-gradient(ellipse_at_top_left,var(--color-brand-50),#fff_60%)]">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-12 md:grid-cols-2 md:pb-24 md:pt-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm font-medium text-brand-700 ring-1 ring-brand-100">
              Made for cafes and restaurants in Nepal
            </p>
            <h1 className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">{BRAND.tagline}</h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-stone-600">
              Take orders, send them to the kitchen, bill in seconds, track stock and staff, and let guests order from their own phone. One system, on the phones and tablets you already have.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href={cta.href} className="btn-primary min-h-12 px-6 text-base">
                {cta.label}
              </Link>
              {BRAND.contactEmail && (
                <a href={`mailto:${BRAND.contactEmail}`} className="inline-flex min-h-12 items-center rounded-xl border border-stone-300 bg-white px-6 text-base font-semibold hover:bg-stone-50">
                  Contact us
                </a>
              )}
              <a href="#features" className="px-2 text-sm font-semibold text-stone-700 underline-offset-4 hover:underline">
                See what it does
              </a>
            </div>
            <ul className="mt-8 grid max-w-md grid-cols-2 gap-x-4 gap-y-2 text-sm text-stone-600">
              {["Works on any phone or tablet", "Guests need no app", "English and Nepali menus", "Rupees, VAT and service charge"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Icon name="check" className="size-4 shrink-0 text-brand-600" /> {t}
                </li>
              ))}
            </ul>
          </div>

          {/* two phones, drawn in CSS so the page needs no images */}
          <div className="relative mx-auto h-[26rem] w-full max-w-md sm:h-[30rem]" aria-hidden="true">
            <div className="absolute left-0 top-6 w-52 rotate-[-4deg] rounded-[2rem] border-[6px] border-stone-900 bg-[#121212] p-3 shadow-2xl sm:w-56">
              <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-stone-700" />
              <div className="rounded-full bg-[#26262a] px-3 py-2 text-[11px] text-stone-400">⌕ Search dishes</div>
              <div className="mt-2 flex gap-1.5 text-[10px] font-medium">
                <span className="rounded-full bg-[#f2603a] px-2.5 py-1 text-white">All</span>
                <span className="rounded-full bg-[#1c1c1e] px-2.5 py-1 text-stone-300">⭐ Best selling</span>
                <span className="rounded-full bg-[#1c1c1e] px-2.5 py-1 text-stone-300">Coffee</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {[
                  ["Momo", "from-sky-900 to-indigo-950", "Rs 200"],
                  ["Latte", "from-amber-800 to-orange-950", "Rs 260"],
                ].map(([n, g, p]) => (
                  <div key={n} className="overflow-hidden rounded-xl bg-[#1c1c1e]">
                    <div className={`grid h-16 place-items-center bg-gradient-to-br ${g} text-2xl font-bold text-white/70`}>{n![0]}</div>
                    <div className="p-2">
                      <p className="text-[11px] font-semibold text-white">{n}</p>
                      <p className="text-[10px] text-stone-400">{p}</p>
                      <div className="mt-1.5 rounded-full bg-[#f2603a] py-1 text-center text-[10px] font-semibold text-white">Add</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-full bg-[#f2603a] py-2 text-center text-[11px] font-semibold text-white">Place order · 2 items · Rs 460</div>
            </div>

            <div className="absolute right-0 top-0 w-52 rotate-[3deg] rounded-[2rem] border-[6px] border-stone-900 bg-stone-50 p-3 shadow-2xl sm:w-56">
              <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-stone-300" />
              <p className="text-xs font-semibold">Good morning</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {[
                  ["Sales today", "Rs 48,250", "bg-emerald-500"],
                  ["Bills paid", "63", "bg-blue-500"],
                ].map(([k, v, c]) => (
                  <div key={k} className="relative overflow-hidden rounded-xl bg-white p-2 ring-1 ring-stone-200">
                    <span className={`absolute inset-x-0 top-0 h-0.5 ${c}`} />
                    <p className="text-[9px] text-stone-500">{k}</p>
                    <p className="text-sm font-semibold">{v}</p>
                  </div>
                ))}
              </div>
              <div className="mt-2 rounded-xl bg-white p-2 ring-1 ring-stone-200">
                <p className="text-[10px] font-semibold">Staff today</p>
                <p className="text-[10px] text-stone-600">4 in now · 1 came and left</p>
              </div>
              {["#112 · Table 4", "#113 · Takeaway", "#114 · Delivery"].map((o, i) => (
                <div key={o} className="mt-2 flex items-center justify-between rounded-xl bg-white p-2 ring-1 ring-stone-200">
                  <span className="text-[11px] font-medium">{o}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${i === 0 ? "bg-amber-100 text-amber-800" : i === 1 ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"}`}>
                    {i === 0 ? "cooking" : i === 1 ? "ready" : "on the way"}
                  </span>
                </div>
              ))}
              <div className="mt-3 flex justify-around border-t border-stone-200 pt-2 text-[9px] text-stone-500">
                <span>Home</span>
                <span>Orders</span>
                <span>Kitchen</span>
                <span>Alerts</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* features */}
      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Everything the floor, the kitchen and the office need</h2>
          <p className="mt-3 text-lg text-stone-600">Tools for the way a busy Nepali cafe actually works, with nothing to install and nothing to stitch together.</p>
        </div>
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <li key={f.title} className="card p-5 transition-shadow hover:shadow-md">
              <span className={`grid size-11 place-items-center rounded-xl ${f.tone}`}>
                <Icon name={f.icon} className="size-5" />
              </span>
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-stone-600">{f.text}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* guests */}
      <section id="guests" className="scroll-mt-20 bg-[#121212] text-zinc-100">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 md:grid-cols-2 md:py-24">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-[#f2603a]">For your guests</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Scan, browse, order. No waiting for a menu.</h2>
            <p className="mt-4 text-lg leading-relaxed text-zinc-400">
              Every table has its own QR code. Guests open your menu on their phone, search, filter by category and see your best sellers first. They can switch to Nepali, add what they want and send it. You accept it before it reaches the kitchen.
            </p>
            <ul className="mt-6 space-y-3 text-zinc-300">
              {[
                "Best sellers shown first, from what you really sold",
                "Photos, Nepali names, add-ons and notes for the kitchen",
                "Call the waiter, ask for water or the bill with one tap",
                "Earn loyalty points and rate the dishes after paying",
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <Icon name="check" className="mt-0.5 size-5 shrink-0 text-[#f2603a]" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-3" aria-hidden="true">
            {[
              ["Buff Momo", "बफ मोमो", "from-rose-900 to-red-950", "Rs 250", "★ 4.7"],
              ["Iced Latte", "आइस ल्याटे", "from-amber-800 to-orange-950", "Rs 260", "★ 4.5"],
              ["Veg Thukpa", "भेज थुक्पा", "from-emerald-900 to-teal-950", "Rs 280", ""],
              ["Gulab Jamun", "गुलाब जामुन", "from-fuchsia-900 to-purple-950", "Rs 120", "★ 4.8"],
            ].map(([n, ne, g, p, r]) => (
              <div key={n} className="overflow-hidden rounded-2xl bg-[#1c1c1e] ring-1 ring-white/5">
                <div className={`relative grid h-24 place-items-center bg-gradient-to-br ${g} text-4xl font-bold text-white/70`}>
                  {n![0]}
                  {r && <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">{r}</span>}
                </div>
                <div className="p-3">
                  <p className="font-semibold">{n}</p>
                  <p className="text-xs text-zinc-500" lang="ne">{ne}</p>
                  <p className="mt-0.5 text-sm text-zinc-400">{p}</p>
                  <div className="mt-2 rounded-full bg-[#f2603a] py-1.5 text-center text-sm font-semibold text-white">Add</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* staff */}
      <section id="staff" className="mx-auto grid max-w-6xl scroll-mt-20 items-center gap-10 px-4 py-16 md:grid-cols-2 md:py-24">
        <div className="order-2 grid gap-3 md:order-1" aria-hidden="true">
          <div className="card p-4">
            <p className="text-sm font-semibold">Attendance · today</p>
            <ul className="mt-3 divide-y divide-stone-100 text-sm">
              {[
                ["Sita Rai", "In now", "08:57", "bg-emerald-100 text-emerald-900"],
                ["Ram Thapa", "Worked", "09:02 to 15:30", "bg-sky-100 text-sky-900"],
                ["Anita Gurung", "Off / not in", "", "bg-stone-200 text-stone-700"],
              ].map(([n, s, t, c]) => (
                <li key={n} className="flex items-center gap-3 py-2.5">
                  <span className="flex-1 font-medium">{n}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${c}`}>{s}</span>
                  <span className="w-28 text-right text-stone-600">{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="card flex items-center gap-3 p-4">
            <span className="grid size-10 place-items-center rounded-xl bg-slate-200 text-slate-600">
              <Icon name="bell" className="size-5" />
            </span>
            <div className="text-sm">
              <p className="font-semibold">Sita Rai clocked in</p>
              <p className="text-stone-500">At 08:57 · 12 m from the cafe</p>
            </div>
          </div>
        </div>
        <div className="order-1 md:order-2">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-700">For your team</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Built for phones, and for the people holding them</h2>
          <p className="mt-4 text-lg leading-relaxed text-stone-600">
            Waiters take orders on their phone, the kitchen sees tickets as they arrive, and cashiers close bills with split payments. Each role sees only what it needs.
          </p>
          <ul className="mt-6 space-y-3 text-stone-700">
            {[
              "Clock in only when you are at the cafe, checked by phone location",
              "Owner alerts when staff arrive or leave, and a daily list of who came and who was off",
              "Hours turn into monthly payroll, with overtime and advances",
              "Roles for owner, manager, cashier, waiter, kitchen and rider",
            ].map((t) => (
              <li key={t} className="flex gap-3">
                <Icon name="check" className="mt-0.5 size-5 shrink-0 text-brand-600" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* how it works */}
      <section id="how" className="scroll-mt-20 bg-stone-50">
        <div className="mx-auto max-w-6xl px-4 py-16 md:py-24">
          <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">Up and running in an afternoon</h2>
          <ol className="mt-12 grid gap-4 md:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="card p-6">
                <span className="grid size-10 place-items-center rounded-full bg-brand-600 text-lg font-bold text-white">{s.n}</span>
                <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
                <p className="mt-1.5 leading-relaxed text-stone-600">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* devices + Nepal */}
      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-16 md:grid-cols-2 md:py-24">
        <div className="card p-6">
          <h3 className="text-xl font-semibold">Works on the devices you already have</h3>
          <p className="mt-2 leading-relaxed text-stone-600">
            Phones, tablets and computers, in any browser. Install it to the home screen like an app. If the Wi-Fi drops, waiters can keep taking dine-in and takeaway orders and they are sent when it comes back.
          </p>
        </div>
        <div className="card p-6">
          <h3 className="text-xl font-semibold">Made around how Nepal does business</h3>
          <p className="mt-2 leading-relaxed text-stone-600">
            Amounts in rupees, 13% VAT and service charge you can set, the Kathmandu time zone, Nepali dish names, and delivery by distance. You always see what is a worked-out figure and what still needs your accountant.
          </p>
        </div>
      </section>

      {/* final call to action */}
      <section className="px-4 pb-16 md:pb-24">
        <div className="mx-auto max-w-6xl rounded-3xl bg-brand-600 px-6 py-14 text-center text-white md:py-20">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Ready to run a calmer service?</h2>
          <p className="mx-auto mt-3 max-w-xl text-lg text-brand-100">Sign in to your restaurant, or get in touch to have yours set up.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href={cta.href} className="inline-flex min-h-12 items-center rounded-xl bg-white px-7 text-base font-semibold text-brand-700 hover:bg-brand-50">
              {cta.label}
            </Link>
            {BRAND.contactEmail && (
              <a href={`mailto:${BRAND.contactEmail}`} className="inline-flex min-h-12 items-center rounded-xl border border-white/50 px-7 text-base font-semibold text-white hover:bg-white/10">
                Contact us
              </a>
            )}
          </div>
        </div>
      </section>

      <footer className="border-t border-stone-200">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-6 text-sm text-stone-500">
          <span className="flex items-center gap-2 font-medium text-stone-700">
            <span className="grid size-6 place-items-center rounded-md bg-brand-600 text-xs font-bold text-white">{BRAND.initial}</span>
            {BRAND.name}
          </span>
          <span className="ml-auto">Made in Nepal for restaurants and cafes</span>
        </div>
      </footer>
    </div>
  );
}
