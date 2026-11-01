// Public company details checked against proacademy-ak.com on 2026-11-02.
export const company = {
  name: "Pro Academy by Ayhan & Karaman GmbH",
  representatives: "Kaan Ayhan, Kenan Karaman, Muhsin Ayhan",
  street: "Auf der Reihe 59",
  city: "45884 Gelsenkirchen",
  register: "HRB 18998, Gelsenkirchen",
  vatId: "DE454511553",
  phone: "+49 151 433 423 92",
  phoneHref: "tel:+4915143342392",
  email: "contact@proacademy-ak.com",
  website: "https://proacademy-ak.com",
  whatsapp: "https://wa.me/4915143342392",
} as const;

export const legalDestinations = {
  privacy: "https://proacademy-ak.com/datenschutz",
  terms: "https://proacademy-ak.com/agb",
  competition: "https://proacademy-ak.com/gs-tb",
} as const;

export const legalLinks = [
  { label: "Impressum", href: "/impressum" },
  { label: "Datenschutz", href: "/datenschutz" },
  { label: "AGB", href: "/agb" },
  { label: "Gewinnspielbedingungen", href: "/gs-tb" },
  { label: "Kontakt", href: "/kontakt" },
] as const;

export const socialLinks = [
  { label: "Instagram", href: "https://www.instagram.com/proacademy.ak/" },
  { label: "Facebook", href: "https://www.facebook.com/proacademyak/" },
  { label: "YouTube", href: "https://www.youtube.com/@proacademyak" },
  { label: "TikTok", href: "https://www.tiktok.com/@proacademy.ak" },
] as const;
