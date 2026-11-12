/* Demo fleet. Aeroplanes: hours, registrations and dates from demo-data/blades-demo-pilot-fixed-wing.csv. Helicopters: the HEMS test profile (testUserSeed.ts, seedMannedPilot2), reproduced with its own RNG. Drones: Matrice 30T/4T and Mavic 3 Thermal from demo-data/blades-demo-drone-commercial.csv; Matrice 300 RTK and WingtraOne are illustrative. Specs from the app's reference table (aircraftLookup.ts) where it has them, otherwise published figures. Photos fetched the way the app does (wikiPhoto.ts) and checked to show the right model. Registrations beyond the CSVs' are illustrative; each model's hours are shared among them, the total unchanged. */
window.BLADES_FLEET = {
 "manned": [
  {
   "key": "h145",
   "type": "H145",
   "maker": "Airbus Helicopters",
   "total": "517:12",
   "first": "2024-03-21",
   "last": "2026-10-26",
   "regs": [
    [
     "SE-HEM",
     "179:34"
    ],
    [
     "SE-JRL",
     "129:17"
    ],
    [
     "SE-JRP",
     "93:05"
    ],
    [
     "SE-HMB",
     "67:01"
    ],
    [
     "SE-JRN",
     "48:15"
    ]
   ],
   "perf": [
    "150",
    "135",
    "17,000"
   ],
   "wt": [
    "3,700",
    "1,919",
    "862"
   ],
   "rng": [
    "357",
    "3.5",
    "320"
   ],
   "units": [
    "kt",
    "l/h"
   ]
  },
  {
   "key": "at76",
   "type": "AT76",
   "maker": "ATR",
   "total": "1092:11",
   "first": "2024-03-04",
   "last": "2026-10-10",
   "regs": [
    [
     "SE-MVD",
     "172:58"
    ],
    [
     "SE-MVG",
     "158:21"
    ],
    [
     "SE-MVC",
     "150:50"
    ],
    [
     "SE-MVF",
     "148:58"
    ],
    [
     "SE-MVA",
     "141:00"
    ],
    [
     "SE-MVB",
     "137:33"
    ],
    [
     "SE-MVE",
     "130:31"
    ]
   ],
   "perf": [
    "250",
    "275",
    "25,000"
   ],
   "wt": [
    "22,800",
    "13,500",
    "6,370"
   ],
   "rng": [
    "825",
    "5",
    "650"
   ],
   "units": [
    "kt",
    "kg/h"
   ]
  },
  {
   "key": "h125",
   "type": "H125",
   "maker": "Airbus Helicopters",
   "total": "1318:42",
   "first": "2019-03-25",
   "last": "2022-03-24",
   "regs": [
    [
     "SE-JLL",
     "457:49"
    ],
    [
     "SE-JBM",
     "329:38"
    ],
    [
     "SE-HUM",
     "237:20"
    ],
    [
     "SE-JFE",
     "170:53"
    ],
    [
     "SE-JPS",
     "123:02"
    ]
   ],
   "perf": [
    "155",
    "140",
    "23,000"
   ],
   "wt": [
    "2,250",
    "1,174",
    "540"
   ],
   "rng": [
    "350",
    "3.5",
    "180"
   ],
   "units": [
    "kt",
    "l/h"
   ]
  },
  {
   "key": "c172",
   "type": "C172",
   "maker": "Cessna",
   "total": "183:39",
   "first": "2018-03-10",
   "last": "2026-10-11",
   "regs": [
    [
     "SE-KBT",
     "63:46"
    ],
    [
     "SE-KFR",
     "45:54"
    ],
    [
     "SE-KUR",
     "33:03"
    ],
    [
     "SE-KML",
     "23:48"
    ],
    [
     "SE-IRG",
     "17:08"
    ]
   ],
   "perf": [
    "163",
    "120",
    "14,000"
   ],
   "wt": [
    "1,157",
    "767",
    "212"
   ],
   "rng": [
    "640",
    "4.5",
    "38"
   ],
   "units": [
    "kt",
    "l/h"
   ]
  },
  {
   "key": "r44",
   "type": "R44",
   "maker": "Robinson",
   "total": "192:36",
   "first": "2016-08-19",
   "last": "2017-08-19",
   "regs": [
    [
     "SE-JRB",
     "73:44"
    ],
    [
     "SE-HHK",
     "53:06"
    ],
    [
     "SE-JVC",
     "38:14"
    ],
    [
     "SE-JOG",
     "27:32"
    ]
   ],
   "perf": [
    "130",
    "110",
    "14,000"
   ],
   "wt": [
    "1,089",
    "680",
    "185"
   ],
   "rng": [
    "300",
    "3",
    "58"
   ],
   "units": [
    "kt",
    "l/h"
   ]
  },
  {
   "key": "da42",
   "type": "DA42",
   "maker": "Diamond",
   "total": "36:35",
   "first": "2021-02-15",
   "last": "2021-09-02",
   "regs": [
    [
     "SE-MLF",
     "14:00"
    ],
    [
     "SE-MLE",
     "10:05"
    ],
    [
     "SE-MLG",
     "7:16"
    ],
    [
     "SE-MLH",
     "5:14"
    ]
   ],
   "perf": [
    "188",
    "170",
    "18,000"
   ],
   "wt": [
    "1,785",
    "1,251",
    "189"
   ],
   "rng": [
    "1,000",
    "6",
    "38"
   ],
   "units": [
    "kt",
    "l/h"
   ]
  }
 ],
 "unmanned": [
  {
   "key": "m300",
   "type": "Matrice 300 RTK",
   "maker": "DJI",
   "total": "186:42",
   "first": "2021-05-12",
   "last": "2024-11-20",
   "regs": [
    [
     "M300-01",
     "71:29"
    ],
    [
     "M300-02",
     "51:28"
    ],
    [
     "M300-03",
     "37:04"
    ],
    [
     "M300-04",
     "26:41"
    ]
   ],
   "kind": "Multirotor",
   "range": "15",
   "mtow": "9 kg",
   "flight": "55",
   "speed": "83",
   "ceil": "7000"
  },
  {
   "key": "wingtra",
   "type": "WingtraOne",
   "maker": "Wingtra",
   "total": "64:15",
   "first": "2024-05-06",
   "last": "2026-09-30",
   "regs": [
    [
     "WING-01",
     "24:36"
    ],
    [
     "WING-02",
     "17:43"
    ],
    [
     "WING-03",
     "12:45"
    ],
    [
     "WING-04",
     "9:11"
    ]
   ],
   "kind": "VTOL",
   "range": "10",
   "mtow": "4.5 kg",
   "flight": "59",
   "speed": "58",
   "ceil": "2500"
  },
  {
   "key": "m30t",
   "type": "Matrice 30T",
   "maker": "DJI",
   "total": "75:40",
   "first": "2023-02-03",
   "last": "2025-04-25",
   "regs": [
    [
     "M30T-01",
     "28:58"
    ],
    [
     "M30T-02",
     "20:52"
    ],
    [
     "M30T-03",
     "15:01"
    ],
    [
     "M30T-04",
     "10:49"
    ]
   ],
   "kind": "Multirotor",
   "range": "15",
   "mtow": "4.1 kg",
   "flight": "41",
   "speed": "83",
   "ceil": "7000"
  },
  {
   "key": "m4t",
   "type": "Matrice 4T",
   "maker": "DJI",
   "total": "40:51",
   "first": "2025-03-03",
   "last": "2026-10-08",
   "regs": [
    [
     "M4T-01",
     "15:38"
    ],
    [
     "M4T-02",
     "11:16"
    ],
    [
     "M4T-03",
     "8:07"
    ],
    [
     "M4T-04",
     "5:50"
    ]
   ],
   "kind": "Multirotor",
   "range": "25",
   "mtow": "1.4 kg",
   "flight": "49",
   "speed": "75",
   "ceil": "6000"
  },
  {
   "key": "m3t",
   "type": "Mavic 3 Thermal",
   "maker": "DJI",
   "total": "18:45",
   "first": "2024-04-03",
   "last": "2026-10-10",
   "regs": [
    [
     "M3T-01",
     "7:11"
    ],
    [
     "M3T-02",
     "5:10"
    ],
    [
     "M3T-03",
     "3:43"
    ],
    [
     "M3T-04",
     "2:41"
    ]
   ],
   "kind": "Multirotor",
   "range": "15",
   "mtow": "920 g",
   "flight": "45",
   "speed": "75",
   "ceil": "6000"
  }
 ],
 "credits": {
  "at76": {
   "author": "Ken Fielding",
   "license": "CC BY-SA 3.0",
   "page": "https://commons.wikimedia.org/wiki/File:F-WWEZ_(948)_ATR.72-212A(500)_FlyFireFly_TLS_30AUG11_(6097869500)_(cropped).jpg"
  },
  "c172": {
   "author": "Md Shaifuzzaman",
   "license": "CC BY-SA 4.0",
   "page": "https://commons.wikimedia.org/wiki/File:Cessna_172_Skyhawk,_S2-AFH.jpg"
  },
  "da42": {
   "author": "Estormiz",
   "license": "CC0",
   "page": "https://commons.wikimedia.org/wiki/File:OH-DAC_Tour_de_Sky_Oulu_20140810_02.JPG"
  },
  "m30t": {
   "author": "ZLEA",
   "license": "CC BY-SA 4.0",
   "page": "https://commons.wikimedia.org/wiki/File:DJI_M30T_RTK_Matrice_30T_(FA34A9EFLE)_(11-16-2024).jpg"
  },
  "m4t": {
   "author": "Blsar-sar",
   "license": "CC BY-SA 4.0",
   "page": "https://commons.wikimedia.org/wiki/File:BLSAR-Matrice-4T_(cropped).jpg"
  },
  "m3t": {
   "author": "ZLEA",
   "license": "CC BY-SA 4.0",
   "page": "https://commons.wikimedia.org/wiki/File:DJI_M3T_Mavic_3T_Thermal_(FA3TEKXHYY)_(4-9-2024).jpg"
  },
  "h145": {
   "author": "James",
   "license": "CC BY-SA 2.0",
   "page": "https://commons.wikimedia.org/wiki/File:G-DAAS_Airbus_Helicopter_H145_(Devon_Air_Ambulance).jpg"
  },
  "r44": {
   "author": "D. Miller",
   "license": "CC BY 2.0",
   "page": "https://commons.wikimedia.org/wiki/File:Robinson_R44_II_(cropped).jpg"
  },
  "h125": {
   "author": "USGS",
   "license": "Public domain",
   "page": "https://commons.wikimedia.org/wiki/File:Airbus_Helicopters_H125_%C3%89cureuil.jpg"
  },
  "m300": {
   "author": "Gaelle1106",
   "license": "CC BY-SA 4.0",
   "page": "https://commons.wikimedia.org/wiki/File:DJI_Matrice_300_RTK_(cropped).jpg"
  },
  "wingtra": {
   "author": "Emily Loosli",
   "license": "CC BY-SA 4.0",
   "page": "https://commons.wikimedia.org/wiki/File:WingtraOne_drone.jpg"
  }
 }
};
