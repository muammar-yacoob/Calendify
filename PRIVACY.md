# Privacy Policy

Calendify reads one page, proposes one calendar event, and shows it to you
before anything happens. It has no account, no server of ours, and no database.

## The short version

Calendify can read a page in one of two ways, and which one it uses is entirely
your choice:

- **Chrome's built-in model (the default).** Reading happens on your own
  computer. Nothing leaves it. No key, no account, no network request.
- **Your own Gemini API key, if you choose to paste one in.** The page text is
  then sent to Google's Gemini API under *your* account and its terms. Calendify
  has no server in that path and no key of its own.

With no key and no built-in model, Calendify still works: the form is filled
from the page's own structured markup and you type in the rest.

## What leaves your computer, and when

Nothing leaves until you ask for an event, and then only if you have pasted in
an API key.

When you do have a key set, and only when the page's own markup did not already
give a title and a date, Calendify sends to Google's Gemini API:

- the text you selected, if you selected any, **or** at most 4,000 characters of
  the visible text of the page if you did not
- the page's URL and title

It does not send the whole page source, images, cookies, form contents, other
tabs, or anything from any other page. Selecting the event text before you
right-click is the narrower option, and it is also the more accurate one.

Google's terms for your account govern what happens to that text. Note that on
Google's **free** Gemini API tier, Google may use what is sent to improve their
models. If what is on screen is confidential, use the built-in model, select
only the event text, or fill the form in by hand.

## Your API key

- It is stored unencrypted in `chrome.storage.local`, in this Chrome profile.
- It is sent only to `generativelanguage.googleapis.com`, as the request header
  Google's API requires.
- It is never displayed again after you save it, and **Remove** deletes it.
- Permission to reach that address is requested at the moment you save a key,
  not when you install the extension. Decline it and Calendify never contacts
  Google's API at all.

## What Calendify does not do

- No analytics, no tracking, no telemetry, no crash reporting.
- No browsing history is collected or transmitted. The URL of the page you are
  reading an event from is sent only as part of a request you asked for, as
  above, and only when a key is set.
- No account, no sign-in, no server operated by Spark Apps.

## Permissions

- **Context Menu Access** (`contextMenus`): the right-click "Calendify" option.
- **Active Tab Access** (`activeTab`) and **Scripting** (`scripting`): to read
  event details out of the page you are looking at, when you ask it to.
- **Storage** (`storage`): to hold your API key if you set one, and to pass the
  page's event details to the popup window.
- **Notifications** (`notifications`): to confirm when the event is ready.
- **Gemini API access** (optional, requested only when you save a key): to send
  the request described above.

## Google Calendar

Calendify never writes to your calendar and never asks for access to it. It
builds a Google Calendar URL with the fields already filled in and opens it, and
**you** press Save. Nothing is created unless you do.

This matters more than it used to. Some of these dates are now read off a page
by a model rather than stated outright, so anything Calendify was not told
directly is marked in the event description as having been inferred. Check it
before you save.

## Contact

For any questions about this privacy policy, please create an issue on our
[GitHub repository](../../issues).
