/**
 * Words on the guest (QR) pages, in English and Nepali. Dish and category names are the business's own (they can give a Nepali
 * name for each); everything else a guest reads on these pages is here. Messages that come back from the server after an
 * action (for example "Some dishes are no longer available") are still in English.
 */

export type Lang = "en" | "ne";
export const LANGS: readonly Lang[] = ["en", "ne"];

type Entry = { en: string; ne: string };

export const STRINGS = {
  // page states
  qrInvalidTitle: { en: "This QR code is not valid", ne: "यो QR कोड मान्य छैन" },
  askStaff: { en: "Please ask a member of staff for help.", ne: "कृपया कर्मचारीलाई सोध्नुहोस्।" },
  orderingOff: { en: "Ordering from your phone is not available here. Please ask a member of staff.", ne: "यहाँ फोनबाट अर्डर गर्न मिल्दैन। कृपया कर्मचारीलाई सोध्नुहोस्।" },
  table: { en: "Table {label}", ne: "टेबल {label}" },
  startOrdering: { en: "Start ordering", ne: "अर्डर सुरु गर्नुहोस्" },
  billSettled: { en: "Your bill for this table has been settled. Thank you! You can start a new order below.", ne: "यस टेबलको तपाईंको बिल चुक्ता भयो। धन्यवाद! तल नयाँ अर्डर सुरु गर्न सक्नुहुन्छ।" },
  tableChanged: { en: "Your table has changed. Please scan the QR code on your new table to keep ordering. Nothing you ordered is lost.", ne: "तपाईंको टेबल परिवर्तन भएको छ। अर्डर जारी राख्न नयाँ टेबलको QR कोड स्क्यान गर्नुहोस्। तपाईंले अर्डर गरेको केही पनि हराएको छैन।" },
  orderCancelled: { en: "This order was cancelled. Please ask a member of staff if you were not expecting that.", ne: "यो अर्डर रद्द गरियो। यो अपेक्षित थिएन भने कृपया कर्मचारीलाई सोध्नुहोस्।" },
  sessionEnded: { en: "Your session at this table has ended. You can start a new one below.", ne: "यस टेबलमा तपाईंको सत्र सकियो। तल नयाँ सुरु गर्न सक्नुहुन्छ।" },
  earnedPoints: { en: "You earned {points} points on this bill.", ne: "यो बिलमा तपाईंले {points} अंक कमाउनुभयो।" },

  // what is on the table
  waitingTitle: { en: "Waiting for the staff to confirm", ne: "कर्मचारीले पुष्टि गर्न पर्खँदै" },
  couldNotTake: { en: "We could not take your order", ne: "हामीले तपाईंको अर्डर लिन सकेनौं" },
  onYourTable: { en: "On your table", ne: "तपाईंको टेबलमा" },
  statusPending: { en: "Received", ne: "प्राप्त भयो" },
  statusPreparing: { en: "Being prepared", ne: "तयार गरिँदैछ" },
  statusReady: { en: "Ready", ne: "तयार" },
  statusServed: { en: "Served", ne: "पस्किइयो" },
  statusCancelled: { en: "Cancelled", ne: "रद्द" },
  billN: { en: "Bill {n}", ne: "बिल {n}" },
  estTotalAll: { en: "Estimated total, all bills", ne: "अनुमानित जम्मा, सबै बिल" },
  estTotal: { en: "Estimated total", ne: "अनुमानित जम्मा" },
  includesCharges: { en: "Includes service charge and tax. Any discount is applied at the counter.", ne: "सेवा शुल्क र कर समावेश छ। कुनै छुट काउन्टरमा लगाइन्छ।" },

  // service buttons
  callWaiter: { en: "Call waiter", ne: "वेटरलाई बोलाउनुहोस्" },
  water: { en: "Water", ne: "पानी" },
  requestBill: { en: "Request bill", ne: "बिल माग्नुहोस्" },
  waiterComing: { en: "Waiter is coming", ne: "वेटर आउँदै हुनुहुन्छ" },
  waterComing: { en: "Water is on the way", ne: "पानी आउँदै छ" },
  billRequested: { en: "Bill requested", ne: "बिल मागिएको छ" },

  // loyalty
  earnPoints: { en: "Earn points on this visit", ne: "यो भ्रमणमा अंक कमाउनुहोस्" },
  pointsGoTo: { en: "Points will go to {phone} when you pay.", ne: "तपाईंले भुक्तानी गर्दा अंक {phone} मा जानेछन्।" },
  billWorth: { en: "This bill is worth about {points} points.", ne: "यो बिल लगभग {points} अंकको हो।" },
  useDifferent: { en: "Use a different number", ne: "अर्को नम्बर प्रयोग गर्नुहोस्" },
  yourPhone: { en: "Your phone number", ne: "तपाईंको फोन नम्बर" },
  offersConsent: { en: "I would also like to receive offers from this restaurant by message (optional)", ne: "म यो रेस्टुरेन्टबाट सन्देशमार्फत अफरहरू पनि पाउन चाहन्छु (ऐच्छिक)" },
  saveNumber: { en: "Save number", ne: "नम्बर सेभ गर्नुहोस्" },
  saving: { en: "Saving…", ne: "सेभ गर्दै…" },
  cancel: { en: "Cancel", ne: "रद्द गर्नुहोस्" },
  numberUse: { en: "We use your number only to give you points. The staff may ask you to confirm it at the counter.", ne: "हामी तपाईंको नम्बर अंक दिन मात्र प्रयोग गर्छौं। कर्मचारीले काउन्टरमा यसलाई पुष्टि गर्न भन्न सक्छन्।" },

  // menu
  allItems: { en: "All items", ne: "सबै परिकार" },
  bestSelling: { en: "⭐ Best selling", ne: "⭐ सबैभन्दा धेरै बिक्री" },
  searchDishes: { en: "Search dishes", ne: "परिकार खोज्नुहोस्" },
  noMatch: { en: "No dishes match “{q}”.", ne: "“{q}” सँग मिल्ने परिकार भेटिएन।" },
  add: { en: "Add", ne: "थप्नुहोस्" },
  fromPrice: { en: "from {price}", ne: "{price} देखि" },
  bestSellerBadge: { en: "Best seller", ne: "धेरै बिक्री" },
  plain: { en: "Plain", ne: "सादा" },
  addToOrder: { en: "Add to order", ne: "अर्डरमा थप्नुहोस्" },
  chooseOne: { en: "choose one", ne: "एउटा छान्नुहोस्" },
  optionalPickAny: { en: "optional, pick any", ne: "ऐच्छिक, जति पनि छान्न सकिन्छ" },
  optional: { en: "optional", ne: "ऐच्छिक" },
  pleaseChoose: { en: "Please choose an option for {group}.", ne: "कृपया {group} को लागि एउटा विकल्प छान्नुहोस्।" },
  close: { en: "Close", ne: "बन्द गर्नुहोस्" },
  notePlaceholder: { en: "Anything we should know? (optional)", ne: "हामीले जान्नुपर्ने केही छ? (ऐच्छिक)" },
  placeOrder: { en: "Place order · {count} · {total}", ne: "अर्डर गर्नुहोस् · {count} · {total}" },
  itemOne: { en: "1 item", ne: "१ परिकार" },
  itemMany: { en: "{n} items", ne: "{n} परिकार" },
  sending: { en: "Sending…", ne: "पठाउँदै…" },
  orderSent: { en: "Order sent. The staff will confirm it shortly.", ne: "अर्डर पठाइयो। कर्मचारीले छिट्टै पुष्टि गर्नेछन्।" },
  serviceTaxAdded: { en: "Service charge and tax are added to the final bill.", ne: "सेवा शुल्क र कर अन्तिम बिलमा जोडिन्छन्।" },

  // feedback
  howWasVisit: { en: "How was your visit?", ne: "तपाईंको भ्रमण कस्तो रह्यो?" },
  thanksRating: { en: "Thank you for rating us", ne: "मूल्याङ्कन गरेकोमा धन्यवाद" },
  rateWhatHad: { en: "Rate what you had (optional)", ne: "तपाईंले खाएका परिकारको मूल्याङ्कन गर्नुहोस् (ऐच्छिक)" },
  sorryWhatWrong: { en: "We are sorry. What went wrong? Only the manager sees this.", ne: "हामी माफी चाहन्छौं। के गल्ती भयो? यो म्यानेजरले मात्र देख्छन्।" },
  anythingToAdd: { en: "Anything you would like to add? (optional)", ne: "थप्न चाहनुहुने केही छ? (ऐच्छिक)" },
  send: { en: "Send", ne: "पठाउनुहोस्" },
  thankPassedOn: { en: "Thank you. We have passed this to the manager.", ne: "धन्यवाद। हामीले यो म्यानेजरलाई पुर्‍याएका छौं।" },
  thankComment: { en: "Thank you for your comment.", ne: "तपाईंको टिप्पणीको लागि धन्यवाद।" },
  noNameAsked: { en: "We do not ask for your name. Please do not include personal details.", ne: "हामी तपाईंको नाम सोध्दैनौं। कृपया व्यक्तिगत विवरण नलेख्नुहोस्।" },
  googleReview: { en: "Tell others about your visit on Google", ne: "तपाईंको भ्रमणबारे Google मा अरूलाई बताउनुहोस्" },

  // language switch
  language: { en: "Language", ne: "भाषा" },
} as const satisfies Record<string, Entry>;

export type StringKey = keyof typeof STRINGS;

/** Text for a key in a language, with {placeholders} filled in. Unknown languages fall back to English. */
export function translate(lang: Lang, key: StringKey, vars: Record<string, string | number> = {}): string {
  const entry: Entry = STRINGS[key];
  const text = lang === "ne" ? entry.ne : entry.en;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export function isLang(value: unknown): value is Lang {
  return value === "en" || value === "ne";
}

/** The placeholders in a piece of text, sorted, for checking that two languages use the same ones. */
export function placeholdersOf(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}
