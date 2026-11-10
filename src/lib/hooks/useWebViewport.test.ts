import {viewportEdges} from './useWebViewport.web'

jest.mock('#/logger', () => ({logger: {error: jest.fn()}}))

it('keeps signed visual edges when Safari grows beyond a stale layout or shifts its origin', () => {
  expect(
    viewportEdges(844, {height: 914, offsetTop: 20, scale: 1}, false),
  ).toEqual({top: 20, bottom: -90})
  expect(
    viewportEdges(844, {height: 720, offsetTop: 30, scale: 1}, false),
  ).toEqual({top: 30, bottom: 94})
})

it('leaves keyboard and pinch panning browser-owned and falls back without the API', () => {
  expect(
    viewportEdges(844, {height: 400, offsetTop: 80, scale: 1}, true),
  ).toEqual({top: 0, bottom: 0})
  expect(
    viewportEdges(844, {height: 400, offsetTop: 80, scale: 2}, false),
  ).toEqual({top: 0, bottom: 0})
  expect(viewportEdges(844, undefined, false)).toEqual({top: 0, bottom: 0})
})

it('rejects invalid metrics instead of emitting NaN or invalid shell positions', () => {
  for (const height of [NaN, Infinity, 0, -1]) {
    expect(() =>
      viewportEdges(844, {height, offsetTop: 0, scale: 1}, false),
    ).toThrow('Invalid visual viewport geometry')
  }
  expect(() =>
    viewportEdges(0, {height: 500, offsetTop: 0, scale: 1}, false),
  ).toThrow('Invalid visual viewport geometry')
})

it('rejects elastic boundary translations without clamping independent chrome height or interior offsets', () => {
  for (const scrollY of [-60, 0, 1000, 1060]) {
    expect(
      viewportEdges(844, {height: 844, offsetTop: -60, scale: 1}, false, {
        scrollY,
        maxScrollY: 1000,
      }),
    ).toEqual({top: 0, bottom: 0})
  }
  expect(
    viewportEdges(844, {height: 844, offsetTop: 60, scale: 1}, false, {
      scrollY: 1060,
      maxScrollY: 1000,
    }),
  ).toEqual({top: 0, bottom: 0})
  expect(
    viewportEdges(844, {height: 914, offsetTop: 20, scale: 1}, false, {
      scrollY: 1000,
      maxScrollY: 1000,
    }),
  ).toEqual({top: 20, bottom: -90})
  expect(
    viewportEdges(844, {height: 800, offsetTop: -12, scale: 1}, false, {
      scrollY: 400,
      maxScrollY: 1000,
    }),
  ).toEqual({top: -12, bottom: 56})
})
