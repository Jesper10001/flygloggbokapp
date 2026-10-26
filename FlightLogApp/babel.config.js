module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    env: {
      // Release-byggen: ta bort console.log/info/debug (felsökningsutskrifter, bl.a. import- och scan-data
      // som annars hamnar i enhetens systemlogg). console.warn/error behålls för felsökning av krascher.
      production: {
        plugins: [['transform-remove-console', { exclude: ['error', 'warn'] }]],
      },
    },
  };
};
