const path = require('path');

const common = {
  entry: './src/index.ts',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
};

const umdConfig = {
  ...common,
  output: {
    filename: 'index.umd.js',
    path: path.resolve(__dirname, 'dist'),
    libraryTarget: 'umd',
    library: 'Mwck',
    umdNamedDefine: true,
    globalObject: 'this',
  },
};

const commonJSConfig = {
  ...common,
  target: 'node',
  output: {
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist'),
    libraryTarget: 'commonjs2',
  },
};

const esmConfig = {
  ...common,
  output: {
    filename: 'index.esm.js',
    path: path.resolve(__dirname, 'dist'),
  },
  optimization: {
    runtimeChunk: false
  }
};

module.exports = [umdConfig, commonJSConfig, esmConfig];
