'use strict'

function buildSpotOrderPlan({
  tokenIn,
  tokenOut,
  amountIn,
  quoteSymbol = 'USDT',
  side = 'buy'
}) {
  if (!tokenIn || !tokenOut) {
    throw new Error('spot mode requires tokenIn and tokenOut')
  }

  return {
    mode: 'spot',
    side,
    tokenIn,
    tokenOut,
    amountIn,
    quoteSymbol
  }
}

module.exports = {
  buildSpotOrderPlan
}
