// from uexcorp api /vehicles, rebuild via UEX sync. snapshot 2026-06-20

export interface ShipModule {
  id: string
  name: string
  scu: number
}

export interface Ship {
  name: string
  /** max scu (hull plus all modules) */
  scu: number
  uexId: number
  containerSizes: number[]
  /** hull scu without modules */
  baseScu?: number
  modules?: ShipModule[]
}

export const DEFAULT_SHIP = "Drake Ironclad"

export const SHIPS: Ship[] = [
  {
    "name": "Aegis Avenger Titan",
    "scu": 8,
    "uexId": 27,
    "containerSizes": [
      1,
      2,
      4
    ]
  },
  {
    "name": "Aegis Avenger Titan Renegade",
    "scu": 8,
    "uexId": 28,
    "containerSizes": [
      1,
      2,
      4
    ]
  },
  {
    "name": "Aegis Hammerhead",
    "scu": 40,
    "uexId": 97,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16
    ]
  },
  {
    "name": "Aegis Hammerhead Best In Show Edition",
    "scu": 40,
    "uexId": 98,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16
    ]
  },
  {
    "name": "Aegis Idris-M",
    "scu": 1326,
    "uexId": 108,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16
    ]
  },
  {
    "name": "Aegis Idris-P",
    "scu": 1374,
    "uexId": 109,
    "containerSizes": []
  },
  {
    "name": "Aegis Reclaimer",
    "scu": 420,
    "uexId": 159,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24
    ]
  },
  {
    "name": "Aegis Reclaimer Best In Show Edition",
    "scu": 180,
    "uexId": 160,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24
    ]
  },
  {
    "name": "Aegis Redeemer",
    "scu": 2,
    "uexId": 161,
    "containerSizes": [
      1
    ]
  },
  {
    "name": "Aegis Retaliator",
    "scu": 74,
    "uexId": 166,
    "containerSizes": []
  },
  {
    "name": "Aegis Retaliator Bomber",
    "scu": 74,
    "uexId": 167,
    "containerSizes": []
  },
  {
    "name": "Aegis Retaliator Cargo Module - Bow",
    "scu": 38,
    "uexId": 217,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24
    ]
  },
  {
    "name": "Aegis Retaliator Cargo Module - Stern",
    "scu": 36,
    "uexId": 216,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16
    ]
  },
  {
    "name": "Aegis Tiburon",
    "scu": 64,
    "uexId": 285,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24,
      32
    ]
  },
  {
    "name": "Anvil Asgard",
    "scu": 180,
    "uexId": 255,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24,
      32
    ]
  },
  {
    "name": "Anvil C8 Pisces",
    "scu": 4,
    "uexId": 36,
    "containerSizes": [
      1,
      2
    ]
  },
  {
    "name": "Anvil C8X Pisces Expedition",
    "scu": 4,
    "uexId": 38,
    "containerSizes": [
      1,
      2
    ]
  },
  {
    "name": "Anvil Carrack",
    "scu": 456,
    "uexId": 39,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16
    ]
  },
  {
    "name": "Anvil Carrack Expedition",
    "scu": 456,
    "uexId": 40,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16
    ]
  },
  {
    "name": "Anvil F7C Hornet Mk II",
    "scu": 2,
    "uexId": 73,
    "containerSizes": [
      1,
      2
    ]
  },
  {
    "name": "Anvil Paladin",
    "scu": 4,
    "uexId": 249,
    "containerSizes": []
  },
  {
    "name": "Anvil Valkyrie",
    "scu": 90,
    "uexId": 194,
    "containerSizes": [
      1,
      2,
      4
    ]
  },
  {
    "name": "Anvil Valkyrie Liberator Edition",
    "scu": 30,
    "uexId": 195,
    "containerSizes": [
      1,
      2,
      4
    ]
  },
  {
    "name": "Argo MOLE",
    "scu": 32,
    "uexId": 122,
    "containerSizes": []
  },
  {
    "name": "Argo MOLE Carbon Edition",
    "scu": 96,
    "uexId": 123,
    "containerSizes": []
  },
  {
    "name": "Argo MOLE Talus Edition",
    "scu": 96,
    "uexId": 124,
    "containerSizes": []
  },
  {
    "name": "Argo MOTH",
    "scu": 224,
    "uexId": 276,
    "containerSizes": []
  },
  {
    "name": "Argo MPUV Cargo",
    "scu": 2,
    "uexId": 125,
    "containerSizes": [
      1,
      2
    ]
  },
  {
    "name": "Argo MPUV Tractor",
    "scu": 16,
    "uexId": 227,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16
    ]
  },
  {
    "name": "Argo RAFT",
    "scu": 192,
    "uexId": 151,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24,
      32
    ]
  },
  {
    "name": "Argo SRV",
    "scu": 12,
    "uexId": 181,
    "containerSizes": [
      1,
      2,
      4
    ]
  },
  {
    "name": "C.O. Mustang Alpha",
    "scu": 4,
    "uexId": 128,
    "containerSizes": [
      1,
      2
    ]
  },
  {
    "name": "C.O. Mustang Alpha Vindicator",
    "scu": 4,
    "uexId": 129,
    "containerSizes": [
      1,
      2
    ]
  },
  {
    "name": "C.O. Nomad",
    "scu": 24,
    "uexId": 136,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16
    ]
  },
  {
    "name": "Crusader A2 Hercules Starlifter",
    "scu": 234,
    "uexId": 14,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24,
      32
    ]
  },
  {
    "name": "Crusader C1 Spirit",
    "scu": 64,
    "uexId": 179,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24,
      32
    ]
  },
  {
    "name": "Crusader C2 Hercules Starlifter",
    "scu": 696,
    "uexId": 35,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24,
      32
    ]
  },
  {
    "name": "Crusader Intrepid",
    "scu": 8,
    "uexId": 236,
    "containerSizes": [
      1,
      2
    ]
  },
  {
    "name": "Crusader M2 Hercules Starlifter",
    "scu": 522,
    "uexId": 117,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24,
      32
    ]
  },
  {
    "name": "Crusader Mercury Star Runner",
    "scu": 114,
    "uexId": 121,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24
    ]
  },
  {
    "name": "Drake Caterpillar",
    "scu": 576,
    "uexId": 41,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24
    ]
  },
  {
    "name": "Drake Caterpillar Best In Show Edition",
    "scu": 576,
    "uexId": 42,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24
    ]
  },
  {
    "name": "Drake Caterpillar Pirate Edition",
    "scu": 576,
    "uexId": 43,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24
    ]
  },
  {
    "name": "Drake Clipper",
    "scu": 12,
    "uexId": 268,
    "containerSizes": []
  },
  {
    "name": "Drake Corsair",
    "scu": 72,
    "uexId": 50,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24
    ]
  },
  {
    "name": "Drake Cutlass Black",
    "scu": 46,
    "uexId": 52,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16
    ]
  },
  {
    "name": "Drake Cutlass Black Best In Show Edition",
    "scu": 46,
    "uexId": 53,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16
    ]
  },
  {
    "name": "Drake Cutlass Blue",
    "scu": 12,
    "uexId": 54,
    "containerSizes": [
      1,
      2
    ]
  },
  {
    "name": "Drake Cutlass Red",
    "scu": 12,
    "uexId": 55,
    "containerSizes": [
      1,
      2
    ]
  },
  {
    "name": "Drake Cutter",
    "scu": 4,
    "uexId": 57,
    "containerSizes": [
      1
    ]
  },
  {
    "name": "Drake Cutter Rambler",
    "scu": 2,
    "uexId": 59,
    "containerSizes": [
      1
    ]
  },
  {
    "name": "Drake Cutter Scout",
    "scu": 2,
    "uexId": 58,
    "containerSizes": [
      1
    ]
  },
  {
    "name": "Drake Golem",
    "scu": 32,
    "uexId": 251,
    "containerSizes": []
  },
  {
    "name": "Drake Golem Ox",
    "scu": 64,
    "uexId": 269,
    "containerSizes": []
  },
  {
    "name": "Drake Ironclad",
    "scu": 2200,
    "uexId": 230,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24,
      32
    ]
  },
  {
    "name": "Drake Ironclad Assault",
    "scu": 1440,
    "uexId": 231,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24,
      32
    ]
  },
  {
    "name": "Drake Vulture",
    "scu": 12,
    "uexId": 201,
    "containerSizes": [
      1,
      2,
      4,
      8
    ]
  },
  {
    "name": "Esperia Prowler Utility",
    "scu": 32,
    "uexId": 262,
    "containerSizes": []
  },
  {
    "name": "Gatac Railen",
    "scu": 640,
    "uexId": 152,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24,
      32
    ]
  },
  {
    "name": "Gatac Syulen",
    "scu": 6,
    "uexId": 188,
    "containerSizes": [
      1
    ]
  },
  {
    "name": "Gatac Tyilui",
    "scu": 96,
    "uexId": 287,
    "containerSizes": [
      1,
      2,
      4,
      6,
      8,
      16,
      24
    ]
  },
  {
    "name": "Grey's Market Shiv",
    "scu": 32,
    "uexId": 266,
    "containerSizes": []
  },
  {
    "name": "MISC Fortune",
    "scu": 16,
    "uexId": 234,
    "containerSizes": [
      1,
      2,
      4
    ]
  },
  {
    "name": "MISC Freelancer",
    "scu": 66,
    "uexId": 80,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24,
      32
    ]
  },
  {
    "name": "MISC Freelancer DUR",
    "scu": 36,
    "uexId": 81,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16
    ]
  },
  {
    "name": "MISC Freelancer MAX",
    "scu": 120,
    "uexId": 82,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24,
      32
    ]
  },
  {
    "name": "MISC Freelancer MIS",
    "scu": 36,
    "uexId": 83,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16
    ]
  },
  {
    "name": "MISC Hull A",
    "scu": 64,
    "uexId": 102,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16
    ]
  },
  {
    "name": "MISC Hull B",
    "scu": 512,
    "uexId": 103,
    "containerSizes": [
      1,
      2,
      4,
      6,
      8,
      12,
      16,
      32
    ]
  },
  {
    "name": "MISC Hull C",
    "scu": 4608,
    "uexId": 104,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24,
      32
    ]
  },
  {
    "name": "MISC Reliant Kore",
    "scu": 6,
    "uexId": 162,
    "containerSizes": [
      1,
      2
    ]
  },
  {
    "name": "MISC Reliant Tana",
    "scu": 1,
    "uexId": 165,
    "containerSizes": [
      1
    ]
  },
  {
    "name": "MISC Starfarer",
    "scu": 291,
    "uexId": 182,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24
    ]
  },
  {
    "name": "MISC Starfarer Gemini",
    "scu": 291,
    "uexId": 183,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24
    ]
  },
  {
    "name": "MISC Starlancer MAX",
    "scu": 224,
    "uexId": 242,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24,
      32
    ]
  },
  {
    "name": "MISC Starlancer TAC",
    "scu": 96,
    "uexId": 241,
    "containerSizes": []
  },
  {
    "name": "Origin 100i",
    "scu": 2,
    "uexId": 1,
    "containerSizes": [
      1,
      2
    ]
  },
  {
    "name": "Origin 125a",
    "scu": 2,
    "uexId": 2,
    "containerSizes": [
      1,
      2
    ]
  },
  {
    "name": "Origin 135c",
    "scu": 6,
    "uexId": 3,
    "containerSizes": [
      1,
      2
    ]
  },
  {
    "name": "Origin 300i",
    "scu": 8,
    "uexId": 4,
    "containerSizes": [
      1,
      2,
      4
    ]
  },
  {
    "name": "Origin 315p",
    "scu": 12,
    "uexId": 5,
    "containerSizes": [
      1,
      2,
      4
    ]
  },
  {
    "name": "Origin 325a",
    "scu": 4,
    "uexId": 6,
    "containerSizes": [
      1,
      2,
      4
    ]
  },
  {
    "name": "Origin 350r",
    "scu": 4,
    "uexId": 7,
    "containerSizes": [
      1,
      2,
      4
    ]
  },
  {
    "name": "Origin 400i",
    "scu": 42,
    "uexId": 8,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24
    ]
  },
  {
    "name": "Origin 600i Executive Edition",
    "scu": 40,
    "uexId": 9,
    "containerSizes": []
  },
  {
    "name": "Origin 600i Explorer",
    "scu": 44,
    "uexId": 10,
    "containerSizes": [
      1,
      2
    ]
  },
  {
    "name": "Origin 600i Touring",
    "scu": 20,
    "uexId": 11,
    "containerSizes": [
      1,
      2
    ]
  },
  {
    "name": "Origin 890 Jump",
    "scu": 388,
    "uexId": 13,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24,
      32
    ]
  },
  {
    "name": "Origin M80",
    "scu": 2,
    "uexId": 283,
    "containerSizes": [
      1
    ]
  },
  {
    "name": "RSI Apollo Medivac",
    "scu": 32,
    "uexId": 15,
    "containerSizes": []
  },
  {
    "name": "RSI Apollo Triage",
    "scu": 32,
    "uexId": 16,
    "containerSizes": []
  },
  {
    "name": "RSI Aurora Mk I CL",
    "scu": 6,
    "uexId": 21,
    "containerSizes": [
      1,
      2
    ]
  },
  {
    "name": "RSI Aurora Mk I ES",
    "scu": 3,
    "uexId": 22,
    "containerSizes": [
      1,
      2
    ]
  },
  {
    "name": "RSI Aurora Mk I LN",
    "scu": 3,
    "uexId": 23,
    "containerSizes": [
      1,
      2
    ]
  },
  {
    "name": "RSI Aurora Mk I LX",
    "scu": 3,
    "uexId": 24,
    "containerSizes": [
      1,
      2
    ]
  },
  {
    "name": "RSI Aurora Mk I MR",
    "scu": 3,
    "uexId": 25,
    "containerSizes": [
      1,
      2
    ]
  },
  {
    "name": "RSI Aurora Mk I SE",
    "scu": 6,
    "uexId": 279,
    "containerSizes": [
      1,
      2
    ]
  },
  {
    "name": "RSI Constellation Andromeda",
    "scu": 96,
    "uexId": 45,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24,
      32
    ]
  },
  {
    "name": "RSI Constellation Aquila",
    "scu": 96,
    "uexId": 46,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24,
      32
    ]
  },
  {
    "name": "RSI Constellation Phoenix",
    "scu": 80,
    "uexId": 47,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24,
      32
    ]
  },
  {
    "name": "RSI Constellation Phoenix Emerald",
    "scu": 80,
    "uexId": 48,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24,
      32
    ]
  },
  {
    "name": "RSI Constellation Taurus",
    "scu": 174,
    "uexId": 49,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24,
      32
    ]
  },
  {
    "name": "RSI Hermes",
    "scu": 288,
    "uexId": 275,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      32
    ]
  },
  {
    "name": "RSI Perseus",
    "scu": 96,
    "uexId": 145,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24,
      32
    ]
  },
  {
    "name": "RSI Polaris",
    "scu": 576,
    "uexId": 147,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24,
      32
    ]
  },
  {
    "name": "RSI Salvation",
    "scu": 6,
    "uexId": 271,
    "containerSizes": []
  },
  {
    "name": "RSI Zeus Mk II CL",
    "scu": 128,
    "uexId": 207,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16,
      24,
      32
    ]
  },
  {
    "name": "RSI Zeus Mk II ES",
    "scu": 32,
    "uexId": 205,
    "containerSizes": [
      1,
      2,
      4,
      8,
      16
    ]
  }
]

const byName = new Map(SHIPS.map((s) => [s.name, s]))

export function shipCapacity(name: string): number {
  return byName.get(name)?.scu ?? 0
}

export function findShip(name: string): Ship | undefined {
  return byName.get(name)
}
