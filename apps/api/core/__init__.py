"""Pure domain logic. **This package imports no Django.**

Feed ranking, snowflake generation, the celebrity threshold, permission
arithmetic and the rate-limit token bucket live here as plain functions over
plain data. Nothing here opens a database connection, reads a setting, or
touches a request.

The payoff is that it is unit-testable in milliseconds without a database, and
the constraint is what keeps it that way: if a module in here needs `django.`,
it belongs in an app instead. See `01-ARCHITECTURE.md` §2.
"""
