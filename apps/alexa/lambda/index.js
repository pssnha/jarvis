'use strict';

/**
 * Alexa fulfillment for a Jarvis circle.
 *
 * Every request is account-linked: the linked access token is forwarded to the
 * Jarvis voice API, which resolves it to a circle member and runs the same
 * agent as the web chat. No calendar/vacation logic lives here — handlers just
 * turn an intent + slots into a sentence and speak the agent's reply.
 *
 * Config: set JARVIS_API_BASE below.
 *   - Alexa-hosted skills can't set Lambda env vars, so edit the constant here.
 *   - On your own AWS Lambda you may instead leave it blank and set the
 *     JARVIS_API_BASE environment variable in the Lambda console.
 */

const Alexa = require('ask-sdk-core');
const https = require('https');

// ── Configure me ──────────────────────────────────────────────────────────
// The public base URL of your Jarvis server (the same address you open the
// Jarvis web app at), with NO trailing slash. Example: 'https://jarvis.example.com'
const JARVIS_API_BASE = 'https://jarvis.passanha.com';
// ──────────────────────────────────────────────────────────────────────────

const API_BASE = (process.env.JARVIS_API_BASE || JARVIS_API_BASE || '').replace(/\/$/, '');
const LINK_PROMPT =
  'Please link your account first. I have sent a card to your Alexa app with the steps.';

/** Minimal JSON HTTPS request (no fetch — works on every Lambda Node runtime).
 *  Resolves { status, json } and never throws. */
function httpJson(method, path, opts = {}) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(API_BASE + path);
    } catch (e) {
      return resolve({ status: 0, json: null });
    }
    const payload = opts.body ? JSON.stringify(opts.body) : null;
    const headers = {};
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(payload);
    }
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers,
        timeout: 7000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch (e) {
            json = null;
          }
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.on('error', () => resolve({ status: 0, json: null }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, json: null });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

/** POST one turn to the Jarvis voice API; returns { ok, speech, needsLink }. */
async function callTurn(accessToken, text) {
  if (!accessToken) return { ok: false, needsLink: true };
  const res = await httpJson('POST', '/api/voice/turn', { token: accessToken, body: { text } });
  if (res.status === 401) return { ok: false, needsLink: true };
  if (res.status !== 200 || !res.json) {
    return { ok: false, speech: "Sorry, I couldn't reach your circle just now." };
  }
  return { ok: true, speech: res.json.speech };
}

/** Fetch the linked circle's name (best-effort, for the welcome message). */
async function circleName(accessToken) {
  if (!accessToken) return null;
  const res = await httpJson('GET', '/api/voice/context', { token: accessToken });
  return res.status === 200 && res.json ? res.json.circleName || null : null;
}

function token(handlerInput) {
  return handlerInput.requestEnvelope.context.System.user.accessToken;
}

/** Speak the agent reply, or send a LinkAccount card if not linked. */
function speak(handlerInput, result, reprompt) {
  if (result.needsLink) {
    return handlerInput.responseBuilder
      .speak(LINK_PROMPT)
      .withLinkAccountCard()
      .getResponse();
  }
  const b = handlerInput.responseBuilder.speak(result.speech);
  if (reprompt) b.reprompt(reprompt);
  else b.withShouldEndSession(true);
  return b.getResponse();
}

const REPROMPT = 'You can ask about the calendar, a vacation, or a flight. What would you like?';

const LaunchRequestHandler = {
  canHandle(h) {
    return Alexa.getRequestType(h.requestEnvelope) === 'LaunchRequest';
  },
  async handle(h) {
    const t = token(h);
    if (!t) {
      return h.responseBuilder.speak(LINK_PROMPT).withLinkAccountCard().getResponse();
    }
    const name = await circleName(t);
    const who = name ? ` for ${name}` : '';
    return h.responseBuilder
      .speak(`Hi! I can tell you what's on the calendar${who}, when your next vacation is, or about a trip. What would you like to know?`)
      .reprompt(REPROMPT)
      .getResponse();
  },
};

const CalendarTodayIntentHandler = {
  canHandle(h) {
    return (
      Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(h.requestEnvelope) === 'CalendarTodayIntent'
    );
  },
  async handle(h) {
    return speak(h, await callTurn(token(h), 'What is on our calendar today?'));
  },
};

const NextVacationIntentHandler = {
  canHandle(h) {
    return (
      Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(h.requestEnvelope) === 'NextVacationIntent'
    );
  },
  async handle(h) {
    return speak(h, await callTurn(token(h), 'When is our next vacation?'));
  },
};

const TripDetailsIntentHandler = {
  canHandle(h) {
    return (
      Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(h.requestEnvelope) === 'TripDetailsIntent'
    );
  },
  async handle(h) {
    const trip = Alexa.getSlotValue(h.requestEnvelope, 'trip');
    if (!trip) {
      return h.responseBuilder
        .speak('Which trip would you like details for?')
        .reprompt('Which trip?')
        .getResponse();
    }
    return speak(h, await callTurn(token(h), `Give me details of our ${trip} trip.`));
  },
};

const FlightTimeIntentHandler = {
  canHandle(h) {
    return (
      Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(h.requestEnvelope) === 'FlightTimeIntent'
    );
  },
  async handle(h) {
    const origin = Alexa.getSlotValue(h.requestEnvelope, 'origin');
    const destination = Alexa.getSlotValue(h.requestEnvelope, 'destination');
    const q =
      origin && destination
        ? `What time is our flight from ${origin} to ${destination}?`
        : origin
          ? `What time is our flight from ${origin}?`
          : 'What time is our next flight?';
    return speak(h, await callTurn(token(h), q));
  },
};

const HelpIntentHandler = {
  canHandle(h) {
    return (
      Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(h.requestEnvelope) === 'AMAZON.HelpIntent'
    );
  },
  handle(h) {
    return h.responseBuilder.speak(REPROMPT).reprompt(REPROMPT).getResponse();
  },
};

const CancelAndStopIntentHandler = {
  canHandle(h) {
    return (
      Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' &&
      ['AMAZON.CancelIntent', 'AMAZON.StopIntent', 'AMAZON.NavigateHomeIntent'].includes(
        Alexa.getIntentName(h.requestEnvelope),
      )
    );
  },
  handle(h) {
    return h.responseBuilder.speak('Goodbye!').withShouldEndSession(true).getResponse();
  },
};

const FallbackIntentHandler = {
  canHandle(h) {
    return (
      Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(h.requestEnvelope) === 'AMAZON.FallbackIntent'
    );
  },
  handle(h) {
    return h.responseBuilder.speak(REPROMPT).reprompt(REPROMPT).getResponse();
  },
};

const SessionEndedRequestHandler = {
  canHandle(h) {
    return Alexa.getRequestType(h.requestEnvelope) === 'SessionEndedRequest';
  },
  handle(h) {
    return h.responseBuilder.getResponse();
  },
};

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(h, error) {
    console.error('Alexa handler error:', error);
    return h.responseBuilder
      .speak("Sorry, something went wrong. Please try again.")
      .getResponse();
  },
};

exports.handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    CalendarTodayIntentHandler,
    NextVacationIntentHandler,
    TripDetailsIntentHandler,
    FlightTimeIntentHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    FallbackIntentHandler,
    SessionEndedRequestHandler,
  )
  .addErrorHandlers(ErrorHandler)
  .lambda();
