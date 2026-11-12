Intentionally empty static output for the Vercel backend project. Every request is rewritten to the
Express function in `api/index.ts`, and serving this folder instead of the project root keeps source
files from being published as static files.
