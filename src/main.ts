import './app/style.css';
import { loadFixture } from './app/fixtures';
import { runFixture } from './app/fixtureView';
import { Game } from './app/game';
import { createIdleOpponent } from './app/idle';
import { readParams } from './app/params';
import { applyCssTokens } from './render/palette';

applyCssTokens(document.documentElement);
const stage = document.getElementById('stage')!;
const hud = document.getElementById('hud')!;
const params = readParams(location.search);

const fixture = params.fixture ? loadFixture(params.fixture) : null;
if (fixture) runFixture(stage, fixture, params.at);
else if (params.debug && params.opponents === 'idle') new Game(stage, hud, params, createIdleOpponent);
else void import('./app/withBots').then(({ createBot }) => new Game(stage, hud, params, createBot));
