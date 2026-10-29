export type PluralForms = { one: string; few: string; many: string; other: string };

/**
 * Plural forms, keyed by the English singular used in `t.plural(n, '{n} order', '{n} orders')`.
 * Polish has four categories: one (1), few (2–4, 22–24 …), many (0, 5–21 …) and other (fractions).
 */
export const PL_PLURALS_ALL: Record<string, PluralForms> = {
  "{n} order": { one: "{n} zamówienie", few: "{n} zamówienia", many: "{n} zamówień", other: "{n} zamówienia" },
  "{n} sale": { one: "{n} sprzedaż", few: "{n} sprzedaże", many: "{n} sprzedaży", other: "{n} sprzedaży" },
  "{n} different price": { one: "{n} inna cena", few: "{n} inne ceny", many: "{n} innych cen", other: "{n} innej ceny" },
  "{n} day": { one: "{n} dzień", few: "{n} dni", many: "{n} dni", other: "{n} dnia" },
  "{n} day ago": { one: "{n} dzień temu", few: "{n} dni temu", many: "{n} dni temu", other: "{n} dnia temu" },
  "{n} customer": { one: "{n} klient", few: "{n} klientów", many: "{n} klientów", other: "{n} klienta" },
  "{n} customer can be synced;": { one: "{n} klient do synchronizacji;", few: "{n} klientów do synchronizacji;", many: "{n} klientów do synchronizacji;", other: "{n} klienta do synchronizacji;" },
  "{n} product": { one: "{n} produkt", few: "{n} produkty", many: "{n} produktów", other: "{n} produktu" },
  "{n} offer": { one: "{n} oferta", few: "{n} oferty", many: "{n} ofert", other: "{n} oferty" },
  "{n} product has a clear match by name.": { one: "{n} produkt ma jednoznaczne dopasowanie po nazwie.", few: "{n} produkty mają jednoznaczne dopasowanie po nazwie.", many: "{n} produktów ma jednoznaczne dopasowanie po nazwie.", other: "{n} produktu ma jednoznaczne dopasowanie po nazwie." },
  "Link {n} clear match": { one: "Połącz {n} jednoznaczne dopasowanie", few: "Połącz {n} jednoznaczne dopasowania", many: "Połącz {n} jednoznacznych dopasowań", other: "Połącz {n} jednoznacznego dopasowania" },
  "Created {n} offer.": { one: "Utworzono {n} ofertę.", few: "Utworzono {n} oferty.", many: "Utworzono {n} ofert.", other: "Utworzono {n} oferty." },
  "Created {n} offer in Von Halsky.": { one: "Utworzono {n} ofertę w Von Halsky.", few: "Utworzono {n} oferty w Von Halsky.", many: "Utworzono {n} ofert w Von Halsky.", other: "Utworzono {n} oferty w Von Halsky." },
  "{n} note": { one: "{n} notatka", few: "{n} notatki", many: "{n} notatek", other: "{n} notatki" },
  "Print {n} label": { one: "Drukuj {n} etykietę", few: "Drukuj {n} etykiety", many: "Drukuj {n} etykiet", other: "Drukuj {n} etykiety" },
  "{n} item": { one: "{n} pozycja", few: "{n} pozycje", many: "{n} pozycji", other: "{n} pozycji" },
  "Sent {n} price to {platform}.": { one: "Wysłano {n} cenę do {platform}.", few: "Wysłano {n} ceny do {platform}.", many: "Wysłano {n} cen do {platform}.", other: "Wysłano {n} ceny do {platform}." },
  "{n} {platform} offer is not linked to a Shopify product, so its price can’t be changed here.": { one: "{n} oferta {platform} nie jest powiązana z produktem Shopify, więc jej ceny nie można tu zmienić.", few: "{n} oferty {platform} nie są powiązane z produktem Shopify, więc ich ceny nie można tu zmienić.", many: "{n} ofert {platform} nie jest powiązanych z produktem Shopify, więc ich ceny nie można tu zmienić.", other: "{n} oferty {platform} nie jest powiązanych z produktem Shopify, więc ich ceny nie można tu zmienić." },
  "{n} product on {platform}": { one: "{n} produkt w {platform}", few: "{n} produkty w {platform}", many: "{n} produktów w {platform}", other: "{n} produktu w {platform}" },
  "{n} entry": { one: "{n} wpis", few: "{n} wpisy", many: "{n} wpisów", other: "{n} wpisu" },
  "{n} past order imported": { one: "Zaimportowano {n} dawne zamówienie", few: "Zaimportowano {n} dawne zamówienia", many: "Zaimportowano {n} dawnych zamówień", other: "Zaimportowano {n} dawnego zamówienia" },
  "{n} demo account from the first setup is still here. Its carriers can't buy real labels, and shipping rules that point at it are skipped.": { one: "{n} konto demo z pierwszej konfiguracji nadal tu jest. Jego przewoźnicy nie mogą kupować prawdziwych etykiet, a reguły wysyłki wskazujące na nie są pomijane.", few: "{n} konta demo z pierwszej konfiguracji nadal tu są. Ich przewoźnicy nie mogą kupować prawdziwych etykiet, a reguły wysyłki wskazujące na nie są pomijane.", many: "{n} kont demo z pierwszej konfiguracji nadal tu jest. Ich przewoźnicy nie mogą kupować prawdziwych etykiet, a reguły wysyłki wskazujące na nie są pomijane.", other: "{n} konta demo z pierwszej konfiguracji nadal tu jest. Ich przewoźnicy nie mogą kupować prawdziwych etykiet, a reguły wysyłki wskazujące na nie są pomijane." },
  "{n} task": { one: "{n} zadanie", few: "{n} zadania", many: "{n} zadań", other: "{n} zadania" },
  "{n} project": { one: "{n} projekt", few: "{n} projekty", many: "{n} projektów", other: "{n} projektu" },
  "{n} finding needs a decision": { one: "{n} ustalenie wymaga decyzji", few: "{n} ustalenia wymagają decyzji", many: "{n} ustaleń wymaga decyzji", other: "{n} ustalenia wymaga decyzji" },
  "{n} unit": { one: "{n} sztuka", few: "{n} sztuki", many: "{n} sztuk", other: "{n} sztuki" },
  "{n} task finished in the last 7 days": { one: "{n} zadanie ukończone w ostatnich 7 dniach", few: "{n} zadania ukończone w ostatnich 7 dniach", many: "{n} zadań ukończonych w ostatnich 7 dniach", other: "{n} zadania ukończonego w ostatnich 7 dniach" },
  "{n} task open": { one: "{n} zadanie otwarte", few: "{n} zadania otwarte", many: "{n} zadań otwartych", other: "{n} zadania otwartego" },
  "vs previous {n} day": { one: "vs poprzedni {n} dzień", few: "vs poprzednie {n} dni", many: "vs poprzednie {n} dni", other: "vs poprzednie {n} dnia" },
};
