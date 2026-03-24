
module.exports = {
  // transpileDependencies: [/vega.*/, /@quasar.*/, 'htmlparser2', 'parse5', 'cheerio', /electron.*/],
  presets: [
    '@quasar/babel-preset-app'
  ],
  plugins: [
    '@babel/plugin-transform-optional-chaining',
    '@babel/plugin-transform-nullish-coalescing-operator'
  ]
}
