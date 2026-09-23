# ChugCraft 3.3 — Rails & Minecarts

Rails, powered rails and rideable minecarts arrive: lay a track, roll a cart
along it, boost it with a redstone block, and ride it across the world.

## New

- **Rails.** Craft 16 rails from 6 iron ingots and a stick. Rails are flat
  plates you walk straight over; a minecart rolls along them. Tracks shape
  themselves: a piece laid in a line is straight, an elbow becomes a
  quarter-turn curve, and tees/crossings keep running straight through. Rails
  need solid ground under them and can be picked up by hand.
- **Powered rails.** Craft 6 from 6 gold ingots, a stick and redstone dust. A
  powered rail next to a **redstone block** switches on (glowing gold with red
  sparks) and shoves carts along at speed; move the redstone block away and it
  goes quiet. Powered rails never curve, exactly like the real thing.
- **Minecarts.** Craft one from five iron ingots. Place it on a rail (or on
  the ground) and press USE / right-click to ride. **W / joystick** rolls
  forward, **S** brakes, **sneak** hops out. A cart that runs off the end of
  the track falls; it can be pushed back onto the rails.
- **Physics with a ceiling.** Carts accelerate on powered rails, coast with
  rolling friction, follow curves without derailing, stop against walls, gain
  speed when you hit them, and are destroyed by lava. Top speed 8 m/s.
- **Persistence.** Carts save with the world, survive exports/backups, and are
  restored exactly where you left them.
- **Advancement:** *On a Rail* — ride a minecart.

## Compatibility

- Saves and backups stay compatible: 3.2 worlds load unchanged, and rails and
  minecarts are ordinary new block ids (179–181) using the same delta
  encoding as every other block.
- All rail art is generated at runtime like the rest of the game — no external
  assets, no new downloads.
- Performance: a rail piece is one quad and one atlas lookup; cart physics is a
  handful of arithmetic ops per tick. Mobile and Potato presets are unaffected.

## Known limits (honest list)

- Rails are flat: no sloped rails, no half-block ascents yet.
- No detector rails, activator rails, chest carts, or furnace carts.
- Carts do not yet collide with mobs/players (they are rideable vehicles, not
  physical obstacles).
- A cart in flight or mid-fall is saved at its current position — it does not
  remember mid-air momentum beyond its velocity vector.
