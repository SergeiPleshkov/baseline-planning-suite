import { describe, expect, it } from 'vitest';
import { cheapestCirculation, type FlowEdge, type FlowNode } from './cheapestCirculation';

const a: FlowNode = {};
const b: FlowNode = {};
const c: FlowNode = {};

describe('cheapestCirculation', () => {
  it('routes the required flow along the cheaper of two parallel edges', () => {
    const required: FlowEdge = { from: b, to: a, lower: 1, upper: 1, cost: 0 };
    const cheap: FlowEdge = { from: a, to: b, lower: 0, upper: 1, cost: -5 };
    const dear: FlowEdge = { from: a, to: b, lower: 0, upper: 1, cost: 5 };
    const flow = cheapestCirculation([required, cheap, dear]);
    expect(flow?.get(cheap)).toBe(1);
    expect(flow?.get(dear)).toBe(0);
  });

  it('honours lower bounds even when they cost more', () => {
    const loop: FlowEdge[] = [
      { from: a, to: b, lower: 2, upper: 3, cost: 10 },
      { from: b, to: c, lower: 0, upper: 3, cost: 0 },
      { from: c, to: a, lower: 0, upper: 3, cost: 0 },
    ];
    expect(cheapestCirculation(loop)?.get(loop[0] as FlowEdge)).toBe(2);
  });

  it('sends flow round a negative-cost cycle even when no flow is required', () => {
    const paid: FlowEdge = { from: a, to: b, lower: 0, upper: 1, cost: -5 };
    const back: FlowEdge = { from: b, to: a, lower: 0, upper: 1, cost: 0 };
    const flow = cheapestCirculation([paid, back]);
    expect([flow?.get(paid), flow?.get(back)]).toEqual([1, 1]);
  });

  it('reports bounds that cannot hold at once', () => {
    expect(
      cheapestCirculation([
        { from: a, to: b, lower: 2, upper: 2, cost: 0 },
        { from: b, to: a, lower: 0, upper: 1, cost: 0 },
      ]),
    ).toBeNull();
  });

  it('rejects fractional or inverted bounds', () => {
    expect(() => cheapestCirculation([{ from: a, to: b, lower: 0.5, upper: 1, cost: 0 }])).toThrow(
      RangeError,
    );
    expect(() => cheapestCirculation([{ from: a, to: b, lower: 2, upper: 1, cost: 0 }])).toThrow(
      RangeError,
    );
  });
});
