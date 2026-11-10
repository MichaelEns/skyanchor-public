import {computeAgeAssuranceState} from '#/ageAssurance/state'
import {AgeAssuranceAccess, AgeAssuranceStatus} from '#/ageAssurance/types'
import * as env from '#/env'
import {app} from '#/lexicons'

jest.mock('#/env', () => ({
  __esModule: true,
  ...jest.requireActual('#/env'),
  IS_WEB: false,
}))

jest.mock('#/ageAssurance/data', () => ({}))
jest.mock('#/ageAssurance/logger', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
  },
}))
jest.mock('#/state/session', () => ({}))

const geolocation = {
  countryCode: undefined,
  regionCode: undefined,
}

describe('computeAgeAssuranceState', () => {
  it('computes access while required account data is pending', () => {
    expect(
      computeAgeAssuranceState({
        hasSession: true,
        geolocation,
        config: {regions: []},
        otherRequiredDataStatus: 'pending',
      }),
    ).toMatchObject({
      status: AgeAssuranceStatus.Unknown,
      access: AgeAssuranceAccess.None,
    })
  })

  describe('web access before the region is known', () => {
    const config = {
      regions: [
        {
          countryCode: 'GB',
          minAccessAge: 13,
          rules: [
            app.bsky.ageassurance.defs.configRegionRuleIfAssuredOverAge.build({
              age: 18,
              access: 'full',
            }),
            app.bsky.ageassurance.defs.configRegionRuleDefault.build({
              access: 'safe',
            }),
          ],
        },
      ],
    }
    const adult = {
      hasSession: true,
      geolocation,
      config,
      metadata: {declaredAge: 36, birthdate: '1990-01-01'},
      otherRequiredDataStatus: 'success' as const,
    }
    beforeEach(() => {
      jest.replaceProperty(env, 'IS_WEB', true)
    })
    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('does not interpret an unknown country with cached adult metadata as an unrestricted region', () => {
      expect(computeAgeAssuranceState(adult)).toMatchObject({
        status: AgeAssuranceStatus.Unknown,
        access: AgeAssuranceAccess.Safe,
      })
    })

    it('does not grant full access from assurance cached for an unconfirmed region', () => {
      expect(
        computeAgeAssuranceState({
          ...adult,
          state: {status: 'assured', access: 'full'},
        }),
      ).toMatchObject({
        status: AgeAssuranceStatus.Unknown,
        access: AgeAssuranceAccess.Safe,
      })
    })

    it('preserves blocked state, restrictive cached access, account errors and the minimum age', () => {
      expect(
        computeAgeAssuranceState({
          ...adult,
          state: {status: 'blocked', access: 'none'},
        }),
      ).toMatchObject({
        status: AgeAssuranceStatus.Blocked,
        access: AgeAssuranceAccess.None,
      })
      expect(
        computeAgeAssuranceState({
          ...adult,
          state: {status: 'assured', access: 'none'},
        }),
      ).toMatchObject({
        status: AgeAssuranceStatus.Unknown,
        access: AgeAssuranceAccess.None,
      })
      expect(
        computeAgeAssuranceState({
          ...adult,
          state: {status: 'assured', access: 'full'},
          otherRequiredDataStatus: 'error',
        }),
      ).toMatchObject({access: AgeAssuranceAccess.None, error: 'account-data'})
      expect(
        computeAgeAssuranceState({
          ...adult,
          metadata: {declaredAge: 12, birthdate: undefined},
          state: {status: 'assured', access: 'full'},
        }),
      ).toMatchObject({access: AgeAssuranceAccess.None})
      expect(
        computeAgeAssuranceState({...adult, config: undefined}),
      ).toMatchObject({
        access: AgeAssuranceAccess.Safe,
        error: 'config',
      })
    })

    it('retains known-region terminal rules and the normally cached country semantics', () => {
      const known = {
        ...adult,
        geolocation: {countryCode: 'GB', regionCode: undefined},
      }
      expect(computeAgeAssuranceState(known)).toMatchObject({
        access: AgeAssuranceAccess.Safe,
      })
      expect(
        computeAgeAssuranceState({
          ...known,
          state: {status: 'assured', access: 'full'},
          otherRequiredDataStatus: 'error',
        }),
      ).toMatchObject({
        status: AgeAssuranceStatus.Assured,
        access: AgeAssuranceAccess.Full,
      })
      expect(
        computeAgeAssuranceState({
          ...known,
          state: {status: 'blocked', access: 'none'},
        }),
      ).toMatchObject({
        status: AgeAssuranceStatus.Blocked,
        access: AgeAssuranceAccess.None,
      })
      expect(
        computeAgeAssuranceState({
          ...adult,
          geolocation: {countryCode: 'CA', regionCode: 'ON'},
        }),
      ).toMatchObject({access: AgeAssuranceAccess.Full})
    })

    it('does not change native unknown-region fallback behavior', () => {
      jest.replaceProperty(env, 'IS_WEB', false)
      expect(computeAgeAssuranceState(adult)).toMatchObject({
        access: AgeAssuranceAccess.Full,
      })
    })
  })

  it('denies access when required account data fails', () => {
    expect(
      computeAgeAssuranceState({
        hasSession: true,
        geolocation,
        config: {regions: []},
        otherRequiredDataStatus: 'error',
      }),
    ).toEqual({
      status: AgeAssuranceStatus.Unknown,
      access: AgeAssuranceAccess.None,
      error: 'account-data',
    })
  })

  it('computes access after a successful response without a birthdate', () => {
    expect(
      computeAgeAssuranceState({
        hasSession: true,
        geolocation,
        config: {regions: []},
        metadata: {birthdate: undefined},
        otherRequiredDataStatus: 'success',
      }),
    ).toMatchObject({
      status: AgeAssuranceStatus.Unknown,
      access: AgeAssuranceAccess.None,
    })
  })

  it('preserves authoritative terminal server state without account data', () => {
    expect(
      computeAgeAssuranceState({
        hasSession: true,
        geolocation: {countryCode: 'AA', regionCode: undefined},
        config: {
          regions: [
            {
              countryCode: 'AA',
              minAccessAge: 13,
              rules: [],
            },
          ],
        },
        state: {status: 'blocked', access: 'none'},
        otherRequiredDataStatus: 'error',
      }),
    ).toMatchObject({
      status: AgeAssuranceStatus.Blocked,
      access: AgeAssuranceAccess.None,
    })
  })
})
