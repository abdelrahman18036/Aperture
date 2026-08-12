"""Ask LiveKit what it is actually holding.

    cd apps/api && uv run manage.py shell
    >>> exec(open("../../docs/check-sfu-room.py").read())

The companion to `verify-sfu-media.js`. That script makes the browser publish;
this one checks the far side, because **a local preview renders whether or not
anything reached the server** — the video element is wired to the local track,
so a call that publishes nothing looks identical from the caller's seat.

Uses the same `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` Django signs room
tokens with, so a mismatch shows up here as an auth failure rather than as a
call that silently carries no media.
"""

import asyncio

from django.conf import settings
from livekit import api


async def main() -> None:
    client = api.LiveKitAPI(
        # The SDK wants HTTP for the management API; settings hold the
        # websocket URL the browser dials.
        url=settings.LIVEKIT_URL.replace("ws://", "http://").replace(
            "wss://", "https://"
        ),
        api_key=settings.LIVEKIT_API_KEY,
        api_secret=settings.LIVEKIT_API_SECRET,
    )

    rooms = await client.room.list_rooms(api.ListRoomsRequest())
    if not rooms.rooms:
        print("no rooms — nobody is in a call")

    for room in rooms.rooms:
        print(f"room {room.name}: {room.num_participants} participant(s)")
        people = await client.room.list_participants(
            api.ListParticipantsRequest(room=room.name)
        )
        for person in people.participants:
            # `identity` is the caller's snowflake, set when Django minted the
            # token — so this also confirms which account the SFU believes it
            # is talking to.
            print(f"  identity={person.identity} state={person.state}")
            for track in person.tracks:
                print(
                    f"    type={track.type} source={track.source} "
                    f"muted={track.muted} {track.width}x{track.height} "
                    f"mime={track.mime_type}"
                )

    await client.aclose()


asyncio.run(main())
