// Config for `npm run studio` (Remotion Studio). The app itself uses server/render.mjs.
import { Config } from '@remotion/cli/config';
import { webpackOverride } from './remotion/webpack-override';

Config.overrideWebpackConfig(webpackOverride);
