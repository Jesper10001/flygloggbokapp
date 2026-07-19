// ISO 3166-2-subdivisioner → läsbart namn. Används för att regionindela flygplatslistan för
// länder med ≥300 flygplatser (t.ex. USA per delstat, Kanada per provins). Koderna kommer från
// seed-datan (assets/icao-airports.json, fältet `region`). Endast de 15 länder som faktiskt
// regionindelas täcks: US, BR, CA, AU, RU, CL, DE, PG, ID, FR, VE, ZA, CN, EC, KR.
// Okända koder faller tillbaka till geoBoundaries-namn (borders.json) → suffixet via regionName().
import { regionDisplayName } from '../utils/borders';

export const REGION_NAMES: Record<string, string> = {
  // ── USA (delstater) ──
  'US-AK': 'Alaska', 'US-AL': 'Alabama', 'US-AR': 'Arkansas', 'US-AZ': 'Arizona', 'US-CA': 'California',
  'US-CO': 'Colorado', 'US-CT': 'Connecticut', 'US-DC': 'District of Columbia', 'US-DE': 'Delaware',
  'US-FL': 'Florida', 'US-GA': 'Georgia', 'US-HI': 'Hawaii', 'US-IA': 'Iowa', 'US-ID': 'Idaho',
  'US-IL': 'Illinois', 'US-IN': 'Indiana', 'US-KS': 'Kansas', 'US-KY': 'Kentucky', 'US-LA': 'Louisiana',
  'US-MA': 'Massachusetts', 'US-MD': 'Maryland', 'US-ME': 'Maine', 'US-MI': 'Michigan', 'US-MN': 'Minnesota',
  'US-MO': 'Missouri', 'US-MS': 'Mississippi', 'US-MT': 'Montana', 'US-NC': 'North Carolina', 'US-ND': 'North Dakota',
  'US-NE': 'Nebraska', 'US-NH': 'New Hampshire', 'US-NJ': 'New Jersey', 'US-NM': 'New Mexico', 'US-NV': 'Nevada',
  'US-NY': 'New York', 'US-OH': 'Ohio', 'US-OK': 'Oklahoma', 'US-OR': 'Oregon', 'US-PA': 'Pennsylvania',
  'US-RI': 'Rhode Island', 'US-SC': 'South Carolina', 'US-SD': 'South Dakota', 'US-TN': 'Tennessee', 'US-TX': 'Texas',
  'US-UT': 'Utah', 'US-VA': 'Virginia', 'US-VT': 'Vermont', 'US-WA': 'Washington', 'US-WI': 'Wisconsin',
  'US-WV': 'West Virginia', 'US-WY': 'Wyoming',

  // ── Brasilien (delstater) ──
  'BR-AC': 'Acre', 'BR-AL': 'Alagoas', 'BR-AM': 'Amazonas', 'BR-AP': 'Amapá', 'BR-BA': 'Bahia',
  'BR-CE': 'Ceará', 'BR-DF': 'Distrito Federal', 'BR-ES': 'Espírito Santo', 'BR-GO': 'Goiás',
  'BR-MA': 'Maranhão', 'BR-MG': 'Minas Gerais', 'BR-MS': 'Mato Grosso do Sul', 'BR-MT': 'Mato Grosso',
  'BR-PA': 'Pará', 'BR-PB': 'Paraíba', 'BR-PE': 'Pernambuco', 'BR-PI': 'Piauí', 'BR-PR': 'Paraná',
  'BR-RJ': 'Rio de Janeiro', 'BR-RN': 'Rio Grande do Norte', 'BR-RO': 'Rondônia', 'BR-RR': 'Roraima',
  'BR-RS': 'Rio Grande do Sul', 'BR-SC': 'Santa Catarina', 'BR-SE': 'Sergipe', 'BR-SP': 'São Paulo',
  'BR-TO': 'Tocantins', 'BR-U-A': 'Other',

  // ── Kanada (provinser/territorier) ──
  'CA-AB': 'Alberta', 'CA-BC': 'British Columbia', 'CA-MB': 'Manitoba', 'CA-NB': 'New Brunswick',
  'CA-NL': 'Newfoundland and Labrador', 'CA-NS': 'Nova Scotia', 'CA-NT': 'Northwest Territories',
  'CA-NU': 'Nunavut', 'CA-ON': 'Ontario', 'CA-PE': 'Prince Edward Island', 'CA-QC': 'Quebec',
  'CA-SK': 'Saskatchewan', 'CA-YT': 'Yukon',

  // ── Australien (delstater/territorier) ──
  'AU-ACT': 'Australian Capital Territory', 'AU-NSW': 'New South Wales', 'AU-NT': 'Northern Territory',
  'AU-QLD': 'Queensland', 'AU-SA': 'South Australia', 'AU-TAS': 'Tasmania', 'AU-VIC': 'Victoria',
  'AU-WA': 'Western Australia',

  // ── Tyskland (Bundesländer) ──
  'DE-BW': 'Baden-Württemberg', 'DE-BY': 'Bavaria', 'DE-BR': 'Berlin/Brandenburg', 'DE-HB': 'Bremen',
  'DE-HE': 'Hesse', 'DE-HH': 'Hamburg', 'DE-MV': 'Mecklenburg-Vorpommern', 'DE-NI': 'Lower Saxony',
  'DE-NW': 'North Rhine-Westphalia', 'DE-RP': 'Rhineland-Palatinate', 'DE-SH': 'Schleswig-Holstein',
  'DE-SL': 'Saarland', 'DE-SN': 'Saxony', 'DE-ST': 'Saxony-Anhalt', 'DE-TH': 'Thuringia',

  // ── Frankrike (regioner) ──
  'FR-ARA': 'Auvergne-Rhône-Alpes', 'FR-BFC': 'Bourgogne-Franche-Comté', 'FR-BRE': 'Brittany',
  'FR-COR': 'Corsica', 'FR-CVL': 'Centre-Val de Loire', 'FR-GES': 'Grand Est', 'FR-HDF': 'Hauts-de-France',
  'FR-IDF': 'Île-de-France', 'FR-NAQ': 'Nouvelle-Aquitaine', 'FR-NOR': 'Normandy', 'FR-OCC': 'Occitania',
  'FR-PAC': "Provence-Alpes-Côte d'Azur", 'FR-PDL': 'Pays de la Loire',

  // ── Sydafrika (provinser) ──
  'ZA-EC': 'Eastern Cape', 'ZA-FS': 'Free State', 'ZA-GT': 'Gauteng', 'ZA-MP': 'Mpumalanga',
  'ZA-NC': 'Northern Cape', 'ZA-NL': 'KwaZulu-Natal', 'ZA-NP': 'Limpopo', 'ZA-NW': 'North West',
  'ZA-WC': 'Western Cape',

  // ── Ryssland (federala subjekt) ──
  'RU-AD': 'Adygea', 'RU-AL': 'Altai Republic', 'RU-ALT': 'Altai Krai', 'RU-AMU': 'Amur Oblast',
  'RU-ARK': 'Arkhangelsk Oblast', 'RU-AST': 'Astrakhan Oblast', 'RU-BA': 'Bashkortostan', 'RU-BEL': 'Belgorod Oblast',
  'RU-BRY': 'Bryansk Oblast', 'RU-BU': 'Buryatia', 'RU-CE': 'Chechnya', 'RU-CHE': 'Chelyabinsk Oblast',
  'RU-CHU': 'Chukotka', 'RU-CU': 'Chuvashia', 'RU-DA': 'Dagestan', 'RU-IN': 'Ingushetia',
  'RU-IRK': 'Irkutsk Oblast', 'RU-IVA': 'Ivanovo Oblast', 'RU-KAM': 'Kamchatka Krai', 'RU-KB': 'Kabardino-Balkaria',
  'RU-KDA': 'Krasnodar Krai', 'RU-KEM': 'Kemerovo Oblast', 'RU-KGD': 'Kaliningrad Oblast', 'RU-KGN': 'Kurgan Oblast',
  'RU-KHA': 'Khabarovsk Krai', 'RU-KHM': 'Khanty-Mansi', 'RU-KIR': 'Kirov Oblast', 'RU-KK': 'Khakassia',
  'RU-KL': 'Kalmykia', 'RU-KLU': 'Kaluga Oblast', 'RU-KO': 'Komi Republic', 'RU-KOS': 'Kostroma Oblast',
  'RU-KR': 'Karelia', 'RU-KRS': 'Kursk Oblast', 'RU-KYA': 'Krasnoyarsk Krai', 'RU-LEN': 'Leningrad Oblast',
  'RU-LIP': 'Lipetsk Oblast', 'RU-MAG': 'Magadan Oblast', 'RU-ME': 'Mari El', 'RU-MO': 'Mordovia',
  'RU-MOS': 'Moscow Oblast', 'RU-MOW': 'Moscow', 'RU-MUR': 'Murmansk Oblast', 'RU-NEN': 'Nenets',
  'RU-NGR': 'Novgorod Oblast', 'RU-NIZ': 'Nizhny Novgorod Oblast', 'RU-NVS': 'Novosibirsk Oblast', 'RU-OMS': 'Omsk Oblast',
  'RU-ORE': 'Orenburg Oblast', 'RU-PER': 'Perm Krai', 'RU-PNZ': 'Penza Oblast', 'RU-PRI': 'Primorsky Krai',
  'RU-PSK': 'Pskov Oblast', 'RU-ROS': 'Rostov Oblast', 'RU-RYA': 'Ryazan Oblast', 'RU-SA': 'Sakha (Yakutia)',
  'RU-SAK': 'Sakhalin Oblast', 'RU-SAM': 'Samara Oblast', 'RU-SAR': 'Saratov Oblast', 'RU-SE': 'North Ossetia-Alania',
  'RU-SMO': 'Smolensk Oblast', 'RU-SPE': 'Saint Petersburg', 'RU-STA': 'Stavropol Krai', 'RU-SVE': 'Sverdlovsk Oblast',
  'RU-TA': 'Tatarstan', 'RU-TAM': 'Tambov Oblast', 'RU-TOM': 'Tomsk Oblast', 'RU-TVE': 'Tver Oblast',
  'RU-TY': 'Tuva', 'RU-TYU': 'Tyumen Oblast', 'RU-UD': 'Udmurtia', 'RU-ULY': 'Ulyanovsk Oblast',
  'RU-VGG': 'Volgograd Oblast', 'RU-VLA': 'Vladimir Oblast', 'RU-VLG': 'Vologda Oblast', 'RU-VOR': 'Voronezh Oblast',
  'RU-YAN': 'Yamalo-Nenets', 'RU-YAR': 'Yaroslavl Oblast', 'RU-YEV': 'Jewish Autonomous Oblast', 'RU-ZAB': 'Zabaykalsky Krai',

  // ── Chile (regioner) ──
  'CL-AI': 'Aysén', 'CL-AN': 'Antofagasta', 'CL-AP': 'Arica y Parinacota', 'CL-AR': 'Araucanía',
  'CL-AT': 'Atacama', 'CL-BI': 'Biobío', 'CL-CO': 'Coquimbo', 'CL-LI': "O'Higgins", 'CL-LL': 'Los Lagos',
  'CL-LR': 'Los Ríos', 'CL-MA': 'Magallanes', 'CL-ML': 'Maule', 'CL-NB': 'Ñuble', 'CL-RM': 'Santiago Metropolitan',
  'CL-TA': 'Tarapacá', 'CL-VS': 'Valparaíso',

  // ── Papua Nya Guinea (provinser) ──
  'PG-CPK': 'Chimbu (Simbu)', 'PG-CPM': 'Central', 'PG-EBR': 'East New Britain', 'PG-EHG': 'Eastern Highlands',
  'PG-EPW': 'Enga', 'PG-ESW': 'East Sepik', 'PG-GPK': 'Gulf', 'PG-HLA': 'Hela', 'PG-JWK': 'Jiwaka',
  'PG-MBA': 'Milne Bay', 'PG-MPL': 'Morobe', 'PG-MPM': 'Madang', 'PG-MRL': 'Manus', 'PG-NCD': 'National Capital District',
  'PG-NIK': 'New Ireland', 'PG-NPP': 'Oro (Northern)', 'PG-NSB': 'Bougainville', 'PG-SAN': 'West Sepik (Sandaun)',
  'PG-SHM': 'Southern Highlands', 'PG-WBK': 'West New Britain', 'PG-WHM': 'Western Highlands', 'PG-WPD': 'Western',

  // ── Indonesien (provinser) ──
  'ID-AC': 'Aceh', 'ID-BA': 'Bali', 'ID-BB': 'Bangka Belitung', 'ID-BE': 'Bengkulu', 'ID-BT': 'Banten',
  'ID-GO': 'Gorontalo', 'ID-JA': 'Jambi', 'ID-JB': 'West Java', 'ID-JI': 'East Java', 'ID-JK': 'Jakarta',
  'ID-JT': 'Central Java', 'ID-KB': 'West Kalimantan', 'ID-KI': 'East Kalimantan', 'ID-KR': 'Riau Islands',
  'ID-KS': 'South Kalimantan', 'ID-KT': 'Central Kalimantan', 'ID-KU': 'North Kalimantan', 'ID-LA': 'Lampung',
  'ID-MA': 'Maluku', 'ID-MU': 'North Maluku', 'ID-NB': 'West Nusa Tenggara', 'ID-NT': 'East Nusa Tenggara',
  'ID-PA': 'Papua', 'ID-PB': 'West Papua', 'ID-PD': 'Southwest Papua', 'ID-PP': 'Central Papua',
  'ID-PS': 'South Papua', 'ID-PT': 'Highland Papua', 'ID-RI': 'Riau', 'ID-SA': 'North Sulawesi',
  'ID-SB': 'West Sumatra', 'ID-SG': 'Southeast Sulawesi', 'ID-SN': 'South Sulawesi', 'ID-SR': 'West Sulawesi',
  'ID-SS': 'South Sumatra', 'ID-ST': 'Central Sulawesi', 'ID-SU': 'North Sumatra', 'ID-YO': 'Yogyakarta',

  // ── Venezuela (delstater) ──
  'VE-A': 'Distrito Capital', 'VE-B': 'Anzoátegui', 'VE-C': 'Apure', 'VE-D': 'Aragua', 'VE-E': 'Barinas',
  'VE-F': 'Bolívar', 'VE-G': 'Carabobo', 'VE-H': 'Cojedes', 'VE-I': 'Falcón', 'VE-J': 'Guárico',
  'VE-K': 'Lara', 'VE-L': 'Mérida', 'VE-M': 'Miranda', 'VE-N': 'Monagas', 'VE-O': 'Nueva Esparta',
  'VE-P': 'Portuguesa', 'VE-R': 'Sucre', 'VE-S': 'Táchira', 'VE-T': 'Trujillo', 'VE-U': 'Yaracuy',
  'VE-V': 'Zulia', 'VE-W': 'Federal Dependencies', 'VE-X': 'La Guaira (Vargas)', 'VE-Y': 'Delta Amacuro',
  'VE-Z': 'Amazonas',

  // ── Kina (provinser) ──
  'CN-11': 'Beijing', 'CN-12': 'Tianjin', 'CN-13': 'Hebei', 'CN-14': 'Shanxi', 'CN-15': 'Inner Mongolia',
  'CN-21': 'Liaoning', 'CN-22': 'Jilin', 'CN-23': 'Heilongjiang', 'CN-31': 'Shanghai', 'CN-32': 'Jiangsu',
  'CN-33': 'Zhejiang', 'CN-34': 'Anhui', 'CN-35': 'Fujian', 'CN-36': 'Jiangxi', 'CN-37': 'Shandong',
  'CN-41': 'Henan', 'CN-42': 'Hubei', 'CN-43': 'Hunan', 'CN-44': 'Guangdong', 'CN-45': 'Guangxi',
  'CN-46': 'Hainan', 'CN-50': 'Chongqing', 'CN-51': 'Sichuan', 'CN-52': 'Guizhou', 'CN-53': 'Yunnan',
  'CN-54': 'Tibet', 'CN-61': 'Shaanxi', 'CN-62': 'Gansu', 'CN-63': 'Qinghai', 'CN-64': 'Ningxia',
  'CN-65': 'Xinjiang',

  // ── Ecuador (provinser) ──
  'EC-A': 'Azuay', 'EC-B': 'Bolívar', 'EC-C': 'Carchi', 'EC-D': 'Orellana', 'EC-E': 'Esmeraldas',
  'EC-F': 'Cañar', 'EC-G': 'Guayas', 'EC-H': 'Chimborazo', 'EC-I': 'Imbabura', 'EC-L': 'Loja',
  'EC-M': 'Manabí', 'EC-N': 'Napo', 'EC-O': 'El Oro', 'EC-P': 'Pichincha', 'EC-R': 'Los Ríos',
  'EC-S': 'Morona-Santiago', 'EC-T': 'Tungurahua', 'EC-U': 'Sucumbíos', 'EC-W': 'Galápagos',
  'EC-X': 'Cotopaxi', 'EC-Y': 'Pastaza', 'EC-Z': 'Zamora-Chinchipe',
  'EC-25': 'Santa Elena', 'EC-26': 'Santo Domingo de los Tsáchilas',

  // ── Sydkorea (provinser/städer) ──
  'KR-11': 'Seoul', 'KR-26': 'Busan', 'KR-27': 'Daegu', 'KR-28': 'Incheon', 'KR-29': 'Gwangju',
  'KR-30': 'Daejeon', 'KR-31': 'Ulsan', 'KR-41': 'Gyeonggi', 'KR-42': 'Gangwon', 'KR-43': 'North Chungcheong',
  'KR-44': 'South Chungcheong', 'KR-45': 'North Jeolla', 'KR-46': 'South Jeolla', 'KR-47': 'North Gyeongsang',
  'KR-48': 'South Gyeongsang', 'KR-49': 'Jeju',

  // ── Indien (delstater/UT) ──
  'IN-AN': 'Andaman and Nicobar Islands', 'IN-AP': 'Andhra Pradesh', 'IN-AR': 'Arunachal Pradesh', 'IN-AS': 'Assam',
  'IN-BR': 'Bihar', 'IN-CH': 'Chandigarh', 'IN-CT': 'Chhattisgarh', 'IN-DH': 'Dadra and Nagar Haveli and Daman and Diu',
  'IN-DL': 'Delhi', 'IN-GA': 'Goa', 'IN-GJ': 'Gujarat', 'IN-HP': 'Himachal Pradesh', 'IN-HR': 'Haryana',
  'IN-JH': 'Jharkhand', 'IN-JK': 'Jammu and Kashmir', 'IN-KA': 'Karnataka', 'IN-KL': 'Kerala', 'IN-LA': 'Ladakh',
  'IN-LD': 'Lakshadweep', 'IN-MH': 'Maharashtra', 'IN-MM': 'Maharashtra', 'IN-ML': 'Meghalaya', 'IN-MN': 'Manipur',
  'IN-MP': 'Madhya Pradesh', 'IN-MZ': 'Mizoram', 'IN-NL': 'Nagaland', 'IN-OR': 'Odisha', 'IN-PB': 'Punjab',
  'IN-PY': 'Puducherry', 'IN-RJ': 'Rajasthan', 'IN-SK': 'Sikkim', 'IN-TG': 'Telangana', 'IN-TN': 'Tamil Nadu',
  'IN-TR': 'Tripura', 'IN-UP': 'Uttar Pradesh', 'IN-UT': 'Uttarakhand', 'IN-WB': 'West Bengal',

  // ── Spanien (autonoma regioner) ──
  'ES-AN': 'Andalusia', 'ES-AR': 'Aragon', 'ES-AS': 'Asturias', 'ES-CB': 'Cantabria', 'ES-CE': 'Ceuta',
  'ES-CL': 'Castile and León', 'ES-CM': 'Castilla-La Mancha', 'ES-CN': 'Canary Islands', 'ES-CT': 'Catalonia',
  'ES-EX': 'Extremadura', 'ES-GA': 'Galicia', 'ES-IB': 'Balearic Islands', 'ES-MC': 'Region of Murcia',
  'ES-MD': 'Madrid', 'ES-ML': 'Melilla', 'ES-NC': 'Navarre', 'ES-PV': 'Basque Country', 'ES-RI': 'La Rioja',
  'ES-VC': 'Valencian Community',

  // ── Storbritannien (länder) ──
  'GB-ENG': 'England', 'GB-NIR': 'Northern Ireland', 'GB-SCT': 'Scotland', 'GB-WLS': 'Wales',

  // ── DR Kongo (provinser) ──
  'CD-BC': 'Kongo Central', 'CD-BU': 'Bas-Uélé', 'CD-EQ': 'Équateur', 'CD-HK': 'Haut-Katanga', 'CD-HL': 'Haut-Lomami',
  'CD-HU': 'Haut-Uélé', 'CD-IT': 'Ituri', 'CD-KC': 'Kasaï Central', 'CD-KE': 'Kasaï Oriental', 'CD-KG': 'Kwango',
  'CD-KL': 'Kwilu', 'CD-KN': 'Kinshasa', 'CD-KS': 'Kasaï', 'CD-LO': 'Lomami', 'CD-LU': 'Lualaba', 'CD-MA': 'Maniema',
  'CD-MN': 'Mai-Ndombe', 'CD-MO': 'Mongala', 'CD-NK': 'North Kivu', 'CD-NU': 'Nord-Ubangi', 'CD-SA': 'Sankuru',
  'CD-SK': 'South Kivu', 'CD-SU': 'Sud-Ubangi', 'CD-TA': 'Tanganyika', 'CD-TO': 'Tshopo', 'CD-TU': 'Tshuapa',

  // ── Nya Zeeland (regioner) ──
  'NZ-AUK': 'Auckland', 'NZ-BOP': 'Bay of Plenty', 'NZ-CAN': 'Canterbury', 'NZ-GIS': 'Gisborne', 'NZ-HKB': "Hawke's Bay",
  'NZ-MBH': 'Marlborough', 'NZ-MWT': 'Manawatū-Whanganui', 'NZ-NSN': 'Nelson', 'NZ-NTL': 'Northland', 'NZ-OTA': 'Otago',
  'NZ-STL': 'Southland', 'NZ-TAS': 'Tasman', 'NZ-TKI': 'Taranaki', 'NZ-WGN': 'Wellington', 'NZ-WKO': 'Waikato',
  'NZ-WTC': 'West Coast', 'NZ-XY': 'Other',

  // ── Argentina (provinser) ──
  'AR-A': 'Salta', 'AR-B': 'Buenos Aires Province', 'AR-C': 'Buenos Aires City', 'AR-D': 'San Luis', 'AR-E': 'Entre Ríos',
  'AR-F': 'La Rioja', 'AR-G': 'Santiago del Estero', 'AR-H': 'Chaco', 'AR-J': 'San Juan', 'AR-K': 'Catamarca',
  'AR-L': 'La Pampa', 'AR-M': 'Mendoza', 'AR-N': 'Misiones', 'AR-P': 'Formosa', 'AR-Q': 'Neuquén', 'AR-R': 'Río Negro',
  'AR-S': 'Santa Fe', 'AR-T': 'Tucumán', 'AR-U': 'Chubut', 'AR-V': 'Tierra del Fuego', 'AR-W': 'Corrientes',
  'AR-X': 'Córdoba', 'AR-Y': 'Jujuy', 'AR-Z': 'Santa Cruz',

  // ── Norge (fylken) ──
  'NO-03': 'Oslo', 'NO-11': 'Rogaland', 'NO-15': 'Møre og Romsdal', 'NO-18': 'Nordland', 'NO-21': 'Svalbard',
  'NO-22': 'Jan Mayen', 'NO-31': 'Østfold', 'NO-32': 'Akershus', 'NO-33': 'Buskerud', 'NO-34': 'Innlandet',
  'NO-39': 'Vestfold', 'NO-40': 'Telemark', 'NO-42': 'Agder', 'NO-46': 'Vestland', 'NO-50': 'Trøndelag',
  'NO-55': 'Troms', 'NO-56': 'Finnmark', 'NO-XX': 'Other',

  // ── Bolivia (departement) ──
  'BO-B': 'Beni', 'BO-C': 'Cochabamba', 'BO-H': 'Chuquisaca', 'BO-L': 'La Paz', 'BO-N': 'Pando', 'BO-O': 'Oruro',
  'BO-P': 'Potosí', 'BO-S': 'Santa Cruz', 'BO-T': 'Tarija',

  // ── Italien (regioner) ──
  'IT-21': 'Piedmont', 'IT-23': 'Aosta Valley', 'IT-25': 'Lombardy', 'IT-32': 'Trentino-South Tyrol', 'IT-34': 'Veneto',
  'IT-36': 'Friuli-Venezia Giulia', 'IT-42': 'Liguria', 'IT-45': 'Emilia-Romagna', 'IT-52': 'Tuscany', 'IT-55': 'Umbria',
  'IT-57': 'Marche', 'IT-62': 'Lazio', 'IT-65': 'Abruzzo', 'IT-67': 'Molise', 'IT-72': 'Campania', 'IT-75': 'Apulia',
  'IT-77': 'Basilicata', 'IT-78': 'Calabria', 'IT-82': 'Sicily', 'IT-88': 'Sardinia',

  // ── Sverige (län) ──
  'SE-AB': 'Stockholm', 'SE-AC': 'Västerbotten', 'SE-BD': 'Norrbotten', 'SE-C': 'Uppsala', 'SE-D': 'Södermanland',
  'SE-E': 'Östergötland', 'SE-F': 'Jönköping', 'SE-G': 'Kronoberg', 'SE-H': 'Kalmar', 'SE-I': 'Gotland',
  'SE-K': 'Blekinge', 'SE-M': 'Skåne', 'SE-N': 'Halland', 'SE-O': 'Västra Götaland', 'SE-Q': 'Västra Götaland',
  'SE-S': 'Värmland', 'SE-T': 'Örebro', 'SE-U': 'Västmanland', 'SE-W': 'Dalarna', 'SE-X': 'Gävleborg',
  'SE-Y': 'Västernorrland', 'SE-Z': 'Jämtland',

  // ── Mexiko (delstater) ──
  'MX-AGU': 'Aguascalientes', 'MX-BCN': 'Baja California', 'MX-BCS': 'Baja California Sur', 'MX-CAM': 'Campeche',
  'MX-CHH': 'Chihuahua', 'MX-CHP': 'Chiapas', 'MX-COA': 'Coahuila', 'MX-COL': 'Colima', 'MX-DIF': 'Mexico City',
  'MX-DUR': 'Durango', 'MX-GRO': 'Guerrero', 'MX-GUA': 'Guanajuato', 'MX-HID': 'Hidalgo', 'MX-JAL': 'Jalisco',
  'MX-MEX': 'State of Mexico', 'MX-MIC': 'Michoacán', 'MX-MOR': 'Morelos', 'MX-NAY': 'Nayarit', 'MX-NLE': 'Nuevo León',
  'MX-OAX': 'Oaxaca', 'MX-PUE': 'Puebla', 'MX-QUE': 'Querétaro', 'MX-ROO': 'Quintana Roo', 'MX-SIN': 'Sinaloa',
  'MX-SLP': 'San Luis Potosí', 'MX-SON': 'Sonora', 'MX-TAB': 'Tabasco', 'MX-TAM': 'Tamaulipas', 'MX-TLA': 'Tlaxcala',
  'MX-VER': 'Veracruz', 'MX-YUC': 'Yucatán', 'MX-ZAC': 'Zacatecas',

  // ── Peru (regioner) ──
  'PE-AMA': 'Amazonas', 'PE-ANC': 'Áncash', 'PE-APU': 'Apurímac', 'PE-ARE': 'Arequipa', 'PE-AYA': 'Ayacucho',
  'PE-CAJ': 'Cajamarca', 'PE-CUS': 'Cusco', 'PE-HUC': 'Huánuco', 'PE-HUV': 'Huancavelica', 'PE-ICA': 'Ica',
  'PE-JUN': 'Junín', 'PE-LAL': 'La Libertad', 'PE-LAM': 'Lambayeque', 'PE-LIM': 'Lima', 'PE-LOR': 'Loreto',
  'PE-MDD': 'Madre de Dios', 'PE-MOQ': 'Moquegua', 'PE-PAS': 'Pasco', 'PE-PIU': 'Piura', 'PE-PUN': 'Puno',
  'PE-SAM': 'San Martín', 'PE-TAC': 'Tacna', 'PE-TUM': 'Tumbes', 'PE-UCA': 'Ucayali',

  // ── Colombia (departement) ──
  'CO-AMA': 'Amazonas', 'CO-ANT': 'Antioquia', 'CO-ARA': 'Arauca', 'CO-ATL': 'Atlántico', 'CO-BOL': 'Bolívar',
  'CO-BOY': 'Boyacá', 'CO-CAL': 'Caldas', 'CO-CAQ': 'Caquetá', 'CO-CAS': 'Casanare', 'CO-CAU': 'Cauca',
  'CO-CES': 'Cesar', 'CO-CHO': 'Chocó', 'CO-COR': 'Córdoba', 'CO-CUN': 'Cundinamarca', 'CO-DC': 'Bogotá',
  'CO-GUA': 'Guainía', 'CO-GUV': 'Guaviare', 'CO-HUI': 'Huila', 'CO-LAG': 'La Guajira', 'CO-MAG': 'Magdalena',
  'CO-MET': 'Meta', 'CO-NAR': 'Nariño', 'CO-NSA': 'Norte de Santander', 'CO-PUT': 'Putumayo', 'CO-QUI': 'Quindío',
  'CO-RIS': 'Risaralda', 'CO-SAN': 'Santander', 'CO-SAP': 'San Andrés and Providencia', 'CO-SUC': 'Sucre',
  'CO-TOL': 'Tolima', 'CO-VAC': 'Valle del Cauca', 'CO-VAU': 'Vaupés', 'CO-VID': 'Vichada',

  // ── Japan (prefekturer) ──
  'JP-01': 'Hokkaido', 'JP-02': 'Aomori', 'JP-03': 'Iwate', 'JP-04': 'Miyagi', 'JP-05': 'Akita', 'JP-06': 'Yamagata',
  'JP-07': 'Fukushima', 'JP-08': 'Ibaraki', 'JP-09': 'Tochigi', 'JP-10': 'Gunma', 'JP-11': 'Saitama', 'JP-12': 'Chiba',
  'JP-13': 'Tokyo', 'JP-14': 'Kanagawa', 'JP-15': 'Niigata', 'JP-16': 'Toyama', 'JP-17': 'Ishikawa', 'JP-18': 'Fukui',
  'JP-19': 'Yamanashi', 'JP-20': 'Nagano', 'JP-21': 'Gifu', 'JP-22': 'Shizuoka', 'JP-23': 'Aichi', 'JP-24': 'Mie',
  'JP-25': 'Shiga', 'JP-26': 'Kyoto', 'JP-27': 'Osaka', 'JP-28': 'Hyōgo', 'JP-29': 'Nara', 'JP-30': 'Wakayama',
  'JP-31': 'Tottori', 'JP-32': 'Shimane', 'JP-33': 'Okayama', 'JP-34': 'Hiroshima', 'JP-35': 'Yamaguchi',
  'JP-36': 'Tokushima', 'JP-37': 'Kagawa', 'JP-38': 'Ehime', 'JP-39': 'Kōchi', 'JP-40': 'Fukuoka', 'JP-41': 'Saga',
  'JP-42': 'Nagasaki', 'JP-43': 'Kumamoto', 'JP-44': 'Ōita', 'JP-45': 'Miyazaki', 'JP-46': 'Kagoshima', 'JP-47': 'Okinawa',

  // ── Tjeckien (regioner) ──
  'CZ-JC': 'South Bohemian', 'CZ-JM': 'South Moravian', 'CZ-KA': 'Karlovy Vary', 'CZ-KR': 'Hradec Králové',
  'CZ-LI': 'Liberec', 'CZ-MO': 'Moravian-Silesian', 'CZ-OL': 'Olomouc', 'CZ-PA': 'Pardubice', 'CZ-PL': 'Plzeň',
  'CZ-PR': 'Prague', 'CZ-ST': 'Central Bohemian', 'CZ-US': 'Ústí nad Labem', 'CZ-VY': 'Vysočina', 'CZ-ZL': 'Zlín',

  // ── Polen (vojvodskap) ──
  'PL-DS': 'Lower Silesian', 'PL-KP': 'Kuyavian-Pomeranian', 'PL-LB': 'Lubusz', 'PL-LD': 'Łódź', 'PL-LU': 'Lublin',
  'PL-MA': 'Lesser Poland', 'PL-MZ': 'Masovian', 'PL-OP': 'Opole', 'PL-PD': 'Podlaskie', 'PL-PK': 'Subcarpathian',
  'PL-PM': 'Pomeranian', 'PL-SK': 'Świętokrzyskie', 'PL-SL': 'Silesian', 'PL-U-A': 'Other', 'PL-WN': 'Warmian-Masurian',
  'PL-WP': 'Greater Poland', 'PL-ZP': 'West Pomeranian',

  // ── Costa Rica (provinser) ──
  'CR-A': 'Alajuela', 'CR-C': 'Cartago', 'CR-G': 'Guanacaste', 'CR-H': 'Heredia', 'CR-L': 'Limón', 'CR-P': 'Puntarenas',
  'CR-SJ': 'San José',

  // ── Belgien (provinser) ──
  'BE-BRU': 'Brussels', 'BE-VAN': 'Antwerp', 'BE-VBR': 'Flemish Brabant', 'BE-VLI': 'Limburg', 'BE-VOV': 'East Flanders',
  'BE-VWV': 'West Flanders', 'BE-WBR': 'Walloon Brabant', 'BE-WHT': 'Hainaut', 'BE-WLG': 'Liège', 'BE-WLX': 'Luxembourg',
  'BE-WNA': 'Namur', 'BE-U-A': 'Other', 'BE-XX': 'Other',

  // ── Nederländerna (provinser) ──
  'NL-DR': 'Drenthe', 'NL-FL': 'Flevoland', 'NL-FR': 'Friesland', 'NL-GE': 'Gelderland', 'NL-GR': 'Groningen',
  'NL-LI': 'Limburg', 'NL-NB': 'North Brabant', 'NL-NH': 'North Holland', 'NL-OV': 'Overijssel', 'NL-UT': 'Utrecht',
  'NL-ZH': 'South Holland', 'NL-ZL': 'Zeeland', 'NL-XX': 'Other',

  // ── Namibia (regioner) ──
  'NA-CA': 'Zambezi', 'NA-ER': 'Erongo', 'NA-HA': 'Hardap', 'NA-KA': 'ǁKaras', 'NA-KE': 'Kavango East', 'NA-KH': 'Khomas',
  'NA-KU': 'Kunene', 'NA-KW': 'Kavango West', 'NA-OD': 'Otjozondjupa', 'NA-OH': 'Omaheke', 'NA-ON': 'Oshana',
  'NA-OS': 'Omusati', 'NA-OT': 'Oshikoto', 'NA-OW': 'Ohangwena',

  // ── Honduras (departement) ──
  'HN-AT': 'Atlántida', 'HN-CH': 'Choluteca', 'HN-CL': 'Colón', 'HN-CM': 'Comayagua', 'HN-CP': 'Copán', 'HN-CR': 'Cortés',
  'HN-EP': 'El Paraíso', 'HN-FM': 'Francisco Morazán', 'HN-GD': 'Gracias a Dios', 'HN-IB': 'Bay Islands', 'HN-IN': 'Intibucá',
  'HN-LE': 'Lempira', 'HN-LP': 'La Paz', 'HN-OC': 'Ocotepeque', 'HN-OL': 'Olancho', 'HN-SB': 'Santa Bárbara',
  'HN-VA': 'Valle', 'HN-YO': 'Yoro',

  // ── Kenya (counties) ──
  'KE-01': 'Mombasa', 'KE-02': 'Kwale', 'KE-03': 'Kilifi', 'KE-04': 'Tana River', 'KE-05': 'Lamu', 'KE-06': 'Taita-Taveta',
  'KE-07': 'Garissa', 'KE-08': 'Wajir', 'KE-09': 'Mandera', 'KE-10': 'Marsabit', 'KE-11': 'Isiolo', 'KE-12': 'Meru',
  'KE-13': 'Tharaka-Nithi', 'KE-14': 'Embu', 'KE-15': 'Kitui', 'KE-16': 'Machakos', 'KE-17': 'Makueni', 'KE-18': 'Nyandarua',
  'KE-19': 'Nyeri', 'KE-20': 'Kirinyaga', 'KE-21': "Murang'a", 'KE-22': 'Kiambu', 'KE-23': 'Turkana', 'KE-24': 'West Pokot',
  'KE-25': 'Samburu', 'KE-26': 'Trans-Nzoia', 'KE-27': 'Uasin Gishu', 'KE-28': 'Elgeyo-Marakwet', 'KE-29': 'Nandi',
  'KE-30': 'Baringo', 'KE-31': 'Laikipia', 'KE-32': 'Nakuru', 'KE-33': 'Narok', 'KE-34': 'Kajiado', 'KE-35': 'Kericho',
  'KE-36': 'Bomet', 'KE-37': 'Kakamega', 'KE-38': 'Vihiga', 'KE-39': 'Bungoma', 'KE-40': 'Busia', 'KE-41': 'Siaya',
  'KE-42': 'Kisumu', 'KE-43': 'Homa Bay', 'KE-44': 'Migori', 'KE-45': 'Kisii', 'KE-46': 'Nyamira', 'KE-47': 'Nairobi',

  // ── Österrike (delstater) ──
  'AT-1': 'Burgenland', 'AT-2': 'Carinthia', 'AT-3': 'Lower Austria', 'AT-4': 'Upper Austria', 'AT-5': 'Salzburg',
  'AT-6': 'Styria', 'AT-7': 'Tyrol', 'AT-8': 'Vorarlberg', 'AT-9': 'Vienna',

  // ── Filippinerna (provinser) ──
  'PH-00': 'Metro Manila', 'PH-AKL': 'Aklan', 'PH-ALB': 'Albay', 'PH-ANT': 'Antique', 'PH-AUR': 'Aurora',
  'PH-BAG': 'Baguio', 'PH-BAS': 'Basilan', 'PH-BIL': 'Biliran', 'PH-BOH': 'Bohol', 'PH-BTG': 'Batangas',
  'PH-BTN': 'Batanes', 'PH-BUK': 'Bukidnon', 'PH-BUL': 'Bulacan', 'PH-CAG': 'Cagayan', 'PH-CAM': 'Camiguin',
  'PH-CAN': 'Camarines Norte', 'PH-CAP': 'Capiz', 'PH-CAS': 'Camarines Sur', 'PH-CAT': 'Catanduanes', 'PH-CAV': 'Cavite',
  'PH-CEB': 'Cebu', 'PH-CGY': 'Cagayan de Oro', 'PH-DAO': 'Davao Oriental', 'PH-DVO': 'Davao del Norte',
  'PH-EAS': 'Eastern Samar', 'PH-ILI': 'Iloilo', 'PH-ILN': 'Ilocos Norte', 'PH-ILS': 'Ilocos Sur', 'PH-ISA': 'Isabela',
  'PH-LAN': 'Lanao del Norte', 'PH-LAS': 'Lanao del Sur', 'PH-LEY': 'Leyte', 'PH-LUN': 'La Union', 'PH-MAD': 'Marinduque',
  'PH-MAS': 'Masbate', 'PH-MDC': 'Occidental Mindoro', 'PH-MDR': 'Oriental Mindoro', 'PH-MSC': 'Misamis Occidental',
  'PH-MSR': 'Misamis Oriental', 'PH-NEC': 'Negros Occidental', 'PH-NER': 'Negros Oriental', 'PH-NSA': 'Northern Samar',
  'PH-NUE': 'Nueva Ecija', 'PH-NUV': 'Nueva Vizcaya', 'PH-PAM': 'Pampanga', 'PH-PAN': 'Pangasinan', 'PH-PLW': 'Palawan',
  'PH-QUE': 'Quezon', 'PH-RIZ': 'Rizal', 'PH-ROM': 'Romblon', 'PH-SCO': 'South Cotabato', 'PH-SIG': 'Siquijor',
  'PH-SLE': 'Southern Leyte', 'PH-SLU': 'Sulu', 'PH-SOR': 'Sorsogon', 'PH-SUN': 'Surigao del Norte', 'PH-SUR': 'Surigao del Sur',
  'PH-TAR': 'Tarlac', 'PH-TAW': 'Tawi-Tawi', 'PH-WSA': 'Samar', 'PH-ZAN': 'Zamboanga del Norte', 'PH-ZAS': 'Zamboanga del Sur',
  'PH-ZMB': 'Zambales', 'PH-ZMC': 'Zamboanga City', 'PH-ZSI': 'Zamboanga Sibugay',
  'PH-DOC': 'Davao Occidental', 'PH-MDN': 'Maguindanao', 'PH-BTC': 'Agusan del Norte',

  // ── Iran (provinser) ──
  'IR-00': 'Markazi', 'IR-01': 'Gilan', 'IR-02': 'Mazandaran', 'IR-03': 'East Azerbaijan', 'IR-04': 'West Azerbaijan',
  'IR-05': 'Kermanshah', 'IR-06': 'Khuzestan', 'IR-07': 'Fars', 'IR-08': 'Kerman', 'IR-09': 'Razavi Khorasan',
  'IR-10': 'Isfahan', 'IR-11': 'Sistan and Baluchestan', 'IR-12': 'Kurdistan', 'IR-13': 'Hamadan',
  'IR-14': 'Chaharmahal and Bakhtiari', 'IR-15': 'Lorestan', 'IR-16': 'Ilam', 'IR-17': 'Kohgiluyeh and Boyer-Ahmad',
  'IR-18': 'Bushehr', 'IR-19': 'Zanjan', 'IR-20': 'Semnan', 'IR-21': 'Yazd', 'IR-22': 'Hormozgan', 'IR-23': 'Tehran',
  'IR-24': 'Ardabil', 'IR-25': 'Qom', 'IR-26': 'Qazvin', 'IR-27': 'Golestan', 'IR-28': 'North Khorasan',
  'IR-29': 'South Khorasan', 'IR-30': 'Alborz',

  // ── Finland (regioner) ──
  'FI-01': 'Åland', 'FI-02': 'South Karelia', 'FI-03': 'Southern Ostrobothnia', 'FI-04': 'Southern Savonia',
  'FI-05': 'Kainuu', 'FI-06': 'Kanta-Häme', 'FI-07': 'Central Ostrobothnia', 'FI-08': 'Central Finland',
  'FI-09': 'Kymenlaakso', 'FI-10': 'Lapland', 'FI-11': 'Pirkanmaa', 'FI-12': 'Ostrobothnia', 'FI-13': 'North Karelia',
  'FI-14': 'North Ostrobothnia', 'FI-15': 'Northern Savonia', 'FI-16': 'Päijänne Tavastia', 'FI-17': 'Satakunta',
  'FI-18': 'Uusimaa', 'FI-19': 'Southwest Finland',
};

/** Läsbart regionnamn: kurerad karta → geoBoundaries-namn (borders.json) → suffixet efter bindestrecket. */
export function regionName(code: string): string {
  return REGION_NAMES[code] || regionDisplayName(code) || code.split('-').slice(1).join('-') || code || 'Unknown';
}
