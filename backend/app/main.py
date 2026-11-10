"""Greenlight API. Returns JSON only; never renders pages."""
from app import deploy  # noqa: F401  (must stay first: prepares the environment on Vercel)
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import errors
from app.config import get_settings
from app.routers import activity, approvals, auth, brand_kit, findings, insights, reviews

settings = get_settings()
settings.assert_safe()

app = FastAPI(title="Greenlight API", version="0.4.0",
              description="Pre-publication brand governance. Contract: docs/API.md")

app.add_middleware(
    CORSMiddleware, allow_origins=[settings.allowed_origin], allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"], allow_headers=["Authorization", "Content-Type"],
)
app.add_exception_handler(errors.ApiError, errors.api_error_handler)
app.add_exception_handler(StarletteHTTPException, errors.http_error_handler)
app.add_exception_handler(RequestValidationError, errors.validation_error_handler)
app.add_exception_handler(Exception, errors.unhandled_error_handler)

for r in (auth, brand_kit, reviews, findings, approvals, insights, activity):
    app.include_router(r.router)

deploy.bootstrap()  # no-op except on Vercel


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok"}
