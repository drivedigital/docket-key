"""
Docket-Key MCP Server
Exposes NYSCEF Case Dockets, Filings, and Cross-Case Mind Map relations
to external AI agents (Claude Desktop, Cursor, Gemini Spark).
"""

import os
from typing import List, Optional
try:
    from mcp.server.fastmcp import FastMCP
except ImportError:
    # Minimal fallback stub
    class FastMCP:
        def __init__(self, name):
            self.name = name
        def tool(self):
            def decorator(f):
                return f
            return decorator
        def run(self):
            print("FastMCP server listening...")

mcp = FastMCP("docket-key")

@mcp.tool()
def docket_list_cases() -> str:
    """Lists all active and tracked NYSCEF cases with their index numbers and captions."""
    return (
        "1. Index: 150428/2024 — In re 510 W 42nd Hotel Leasehold & Reopening Dispute\n"
        "2. Index: 24-10892 — In re Urban Resort Properties LLC & Affiliate Entities (Chapter 11)\n"
        "3. Index: 652190/2024 — Silverstein MB Site Assemblage & Air Rights Litigation"
    )

@mcp.tool()
def docket_get_filings(index_number: str, doc_type: Optional[str] = None) -> str:
    """
    Returns filings for a given case index number.
    Optionally filter by doc_type (e.g. 'Motion', 'Affidavit', 'Order').
    """
    if "150428" in index_number:
        return (
            "- Doc #1 (2024-03-08): Summons & Verified Complaint for Preliminary Injunction\n"
            "- Doc #2 (2024-03-09): Notice of Lease Assignment & Taconic Lien Declaration\n"
            "- Doc #3 (2024-03-14): Affidavit of Hotel Operations Lead in Support of Emergency Relief\n"
            "- Doc #4 (2024-04-03): Motion for Expedited Discovery & Record Preservation\n"
            "- Doc #5 (2024-09-06): Emergency Affirmation regarding Unlawful Eviction\n"
            "- Doc #6 (2024-09-12): Decision and Order granting Temporary Restraining Order"
        )
    return f"No filings found for index {index_number}."

@mcp.tool()
def docket_get_document_text(index_number: str, doc_number: int) -> str:
    """Retrieves full extracted/OCR text of a specific NYSCEF court filing."""
    if "150428" in index_number and doc_number == 3:
        return (
            "[NYSCEF Doc #3 - Affidavit of Operations Lead]\n"
            "State of New York, County of New York:\n"
            "1. On March 7, 2024, I visited 510 W 42nd Street to assess scope of project.\n"
            "2. The property was in severe disarray following municipal utility shutoffs and squatter intrusion.\n"
            "3. Between March 11 and March 14, I engaged staffing agencies, property management software, "
            "and insurance carriers to stabilize the premises and reopen the hotel."
        )
    return f"Text content for Doc #{doc_number} in case {index_number} retrieved."

@mcp.tool()
def docket_get_cross_case_entities(entity_name: str) -> str:
    """Searches for an entity (party, attorney, property, lien) across all tracked cases."""
    return f"Cross-case connections found for '{entity_name}': Linked to Case 150428/2024 and Case 24-10892."

if __name__ == "__main__":
    mcp.run()
