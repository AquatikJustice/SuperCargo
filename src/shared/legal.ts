// Star Citizen trademark attribution + unofficial-project disclaimer.
//
// Required by Cloud Imperium's Fankit / Fandom guidance for community projects:
// fan tools must make clear they are unofficial / not endorsed, and must carry
// the CIG trademark notice. The "Star Citizen - Made by the Community" badge is
// an official Fankit asset (drop the PNG at renderer/public/made-by-community.png).
// See https://robertsspaceindustries.com/en/fankit and the Fankit & Fandom FAQ.

export const APP_NAME = 'SuperCargo'

export const FANKIT_URL = 'https://robertsspaceindustries.com/en/fankit'

/** This project is unofficial / not affiliated. */
export const UNOFFICIAL_NOTICE =
  'SuperCargo is an unofficial Star Citizen community tool. It is not endorsed by, sponsored by, or affiliated with Cloud Imperium Games or Roberts Space Industries.'

/** CIG trademark + content ownership notice. */
export const TRADEMARK_NOTICE =
  'Star Citizen®, Squadron 42®, Roberts Space Industries®, and Cloud Imperium® are registered trademarks of Cloud Imperium Rights LLC. All game content and related marks are the property of Cloud Imperium Rights LLC and Cloud Imperium Rights Ltd.'

export const MADE_BY_COMMUNITY = 'Star Citizen - Made by the Community'

/** Community data sources SuperCargo builds on, credited in the About screen. */
export interface DataCredit {
  name: string
  url: string
  /** what we use it for. */
  use: string
}

export const DATA_CREDITS: DataCredit[] = [
  { name: 'UEXcorp', url: 'https://uexcorp.space', use: 'ship roster, commodities & trade data' },
  {
    name: 'sc-cargo.space',
    url: 'https://sc-cargo.space',
    use: 'cargo-bay grid layouts & dimensions'
  },
  {
    name: 'Ratjack',
    url: 'https://ratjack.net/Star-Citizen/Cargo-Grids/',
    use: 'cargo grid reference (the basis for the sc-cargo.space grids)'
  },
  {
    name: 'scunpacked (StarCitizenWiki)',
    url: 'https://github.com/StarCitizenWiki/scunpacked-data',
    use: 'datamined game data for cross-checking'
  }
]

/** One-line credit string, e.g. for a compact footer. */
export const DATA_CREDIT_LINE = `Cargo data thanks to ${DATA_CREDITS.map((c) => c.name).join(', ')}.`
