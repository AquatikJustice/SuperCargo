// required by CIG fankit terms

export const APP_NAME = 'SuperCargo'

export const FANKIT_URL = 'https://robertsspaceindustries.com/en/fankit'

export const UNOFFICIAL_NOTICE =
  'SuperCargo is an unofficial Star Citizen community tool. It is not endorsed by, sponsored by, or affiliated with Cloud Imperium Games or Roberts Space Industries.'

export const TRADEMARK_NOTICE =
  'Star Citizen®, Squadron 42®, Roberts Space Industries®, and Cloud Imperium® are registered trademarks of Cloud Imperium Rights LLC. All game content and related marks are the property of Cloud Imperium Rights LLC and Cloud Imperium Rights Ltd.'

export const MADE_BY_COMMUNITY = 'Star Citizen - Made by the Community'

export interface DataCredit {
  name: string
  url: string
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
    use: 'cargo grid reference'
  },
  {
    name: 'scunpacked (StarCitizenWiki)',
    url: 'https://github.com/StarCitizenWiki/scunpacked-data',
    use: 'datamined game data for cross-checking'
  }
]

export const DATA_CREDIT_LINE = `Cargo data thanks to ${DATA_CREDITS.map((c) => c.name).join(', ')}.`
