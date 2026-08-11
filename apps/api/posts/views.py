"""Views for the posts app.

Thin by rule: parse the request, call a selector or a service, return. A view
that queries the ORM directly is the smell -- move it to `selectors.py`.
"""
