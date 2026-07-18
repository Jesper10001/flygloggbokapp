// ISO 3166-1 alpha-2 → engelskt landsnamn. Pålitligt (Intl.DisplayNames saknas i vissa Hermes-
// builds → visade bara landskoden). Täcker alla länder i seed-datan / continents.ts.
export const COUNTRY_NAMES: Record<string, string> = {
  // Nordamerika
  US: 'United States', CA: 'Canada', MX: 'Mexico', GT: 'Guatemala', BZ: 'Belize', SV: 'El Salvador',
  HN: 'Honduras', NI: 'Nicaragua', CR: 'Costa Rica', PA: 'Panama', CU: 'Cuba', JM: 'Jamaica', HT: 'Haiti',
  DO: 'Dominican Republic', BS: 'Bahamas', BB: 'Barbados', TT: 'Trinidad and Tobago', GD: 'Grenada',
  LC: 'Saint Lucia', VC: 'Saint Vincent and the Grenadines', AG: 'Antigua and Barbuda', DM: 'Dominica',
  KN: 'Saint Kitts and Nevis', PR: 'Puerto Rico', GL: 'Greenland', BM: 'Bermuda', KY: 'Cayman Islands',
  AW: 'Aruba', CW: 'Curaçao', SX: 'Sint Maarten', TC: 'Turks and Caicos Islands', VG: 'British Virgin Islands',
  VI: 'U.S. Virgin Islands', AI: 'Anguilla', MS: 'Montserrat', BQ: 'Caribbean Netherlands', GP: 'Guadeloupe',
  MQ: 'Martinique', BL: 'Saint Barthélemy', MF: 'Saint Martin', PM: 'Saint Pierre and Miquelon',

  // Sydamerika
  BR: 'Brazil', AR: 'Argentina', CL: 'Chile', CO: 'Colombia', PE: 'Peru', VE: 'Venezuela', EC: 'Ecuador',
  BO: 'Bolivia', PY: 'Paraguay', UY: 'Uruguay', GY: 'Guyana', SR: 'Suriname', GF: 'French Guiana',
  FK: 'Falkland Islands',

  // Europa
  GB: 'United Kingdom', IE: 'Ireland', FR: 'France', DE: 'Germany', ES: 'Spain', PT: 'Portugal', IT: 'Italy',
  NL: 'Netherlands', BE: 'Belgium', LU: 'Luxembourg', CH: 'Switzerland', AT: 'Austria', DK: 'Denmark',
  SE: 'Sweden', NO: 'Norway', FI: 'Finland', IS: 'Iceland', PL: 'Poland', CZ: 'Czechia', SK: 'Slovakia',
  HU: 'Hungary', RO: 'Romania', BG: 'Bulgaria', GR: 'Greece', HR: 'Croatia', SI: 'Slovenia', RS: 'Serbia',
  BA: 'Bosnia and Herzegovina', ME: 'Montenegro', MK: 'North Macedonia', AL: 'Albania', XK: 'Kosovo',
  LT: 'Lithuania', LV: 'Latvia', EE: 'Estonia', BY: 'Belarus', UA: 'Ukraine', MD: 'Moldova', RU: 'Russia',
  CY: 'Cyprus', MT: 'Malta', AD: 'Andorra', MC: 'Monaco', SM: 'San Marino', VA: 'Vatican City',
  LI: 'Liechtenstein', FO: 'Faroe Islands', GI: 'Gibraltar', IM: 'Isle of Man', JE: 'Jersey', GG: 'Guernsey',
  AX: 'Åland Islands', SJ: 'Svalbard and Jan Mayen',

  // Afrika
  EG: 'Egypt', LY: 'Libya', TN: 'Tunisia', DZ: 'Algeria', MA: 'Morocco', EH: 'Western Sahara',
  MR: 'Mauritania', ML: 'Mali', NE: 'Niger', TD: 'Chad', SD: 'Sudan', SS: 'South Sudan', ET: 'Ethiopia',
  ER: 'Eritrea', DJ: 'Djibouti', SO: 'Somalia', KE: 'Kenya', UG: 'Uganda', RW: 'Rwanda', BI: 'Burundi',
  TZ: 'Tanzania', CD: 'DR Congo', CG: 'Congo', CF: 'Central African Republic', CM: 'Cameroon', GA: 'Gabon',
  GQ: 'Equatorial Guinea', ST: 'São Tomé and Príncipe', NG: 'Nigeria', BJ: 'Benin', TG: 'Togo', GH: 'Ghana',
  CI: "Côte d'Ivoire", LR: 'Liberia', SL: 'Sierra Leone', GN: 'Guinea', GW: 'Guinea-Bissau', SN: 'Senegal',
  GM: 'Gambia', CV: 'Cape Verde', BF: 'Burkina Faso', ZA: 'South Africa', NA: 'Namibia', BW: 'Botswana',
  ZW: 'Zimbabwe', ZM: 'Zambia', MZ: 'Mozambique', MW: 'Malawi', LS: 'Lesotho', SZ: 'Eswatini',
  MG: 'Madagascar', KM: 'Comoros', MU: 'Mauritius', SC: 'Seychelles', RE: 'Réunion', YT: 'Mayotte',
  AO: 'Angola',

  // Asien
  CN: 'China', JP: 'Japan', KR: 'South Korea', KP: 'North Korea', MN: 'Mongolia', TW: 'Taiwan',
  HK: 'Hong Kong', MO: 'Macau', IN: 'India', PK: 'Pakistan', BD: 'Bangladesh', LK: 'Sri Lanka', NP: 'Nepal',
  BT: 'Bhutan', MV: 'Maldives', AF: 'Afghanistan', IR: 'Iran', IQ: 'Iraq', SA: 'Saudi Arabia', YE: 'Yemen',
  OM: 'Oman', AE: 'United Arab Emirates', QA: 'Qatar', BH: 'Bahrain', KW: 'Kuwait', JO: 'Jordan',
  IL: 'Israel', PS: 'Palestine', LB: 'Lebanon', SY: 'Syria', TR: 'Turkey', GE: 'Georgia', AM: 'Armenia',
  AZ: 'Azerbaijan', KZ: 'Kazakhstan', UZ: 'Uzbekistan', TM: 'Turkmenistan', TJ: 'Tajikistan',
  KG: 'Kyrgyzstan', TH: 'Thailand', VN: 'Vietnam', LA: 'Laos', KH: 'Cambodia', MM: 'Myanmar',
  MY: 'Malaysia', SG: 'Singapore', ID: 'Indonesia', PH: 'Philippines', BN: 'Brunei', TL: 'Timor-Leste',

  // Oceanien
  AU: 'Australia', NZ: 'New Zealand', PG: 'Papua New Guinea', FJ: 'Fiji', SB: 'Solomon Islands',
  VU: 'Vanuatu', NC: 'New Caledonia', PF: 'French Polynesia', WS: 'Samoa', TO: 'Tonga', KI: 'Kiribati',
  FM: 'Micronesia', MH: 'Marshall Islands', PW: 'Palau', NR: 'Nauru', TV: 'Tuvalu', CK: 'Cook Islands',
  NU: 'Niue', GU: 'Guam', MP: 'Northern Mariana Islands', WF: 'Wallis and Futuna', TK: 'Tokelau',
  AS: 'American Samoa',

  // Antarktis / övrigt
  AQ: 'Antarctica', TF: 'French Southern Territories', GS: 'South Georgia', BV: 'Bouvet Island',
  HM: 'Heard and McDonald Islands',
};

/** Fullständigt landsnamn för en 2-bokstavskod (faller tillbaka till koden om okänd). */
export function countryNameFull(cc: string): string {
  const c = (cc || '').toUpperCase();
  return COUNTRY_NAMES[c] || c;
}
