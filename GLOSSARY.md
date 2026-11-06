# Worms on Letters

A tool for composing still images of soft 3D worms that have fallen onto a letterform or other partly transparent image standing in 3D space.

## Language

**Source Image**:
The partly transparent image supplied by the user.
_Avoid_: Picture, input

**Cutout**:
The solid form made from the visible parts of the Source Image, standing upright with real thickness and never moving. Transparent parts of the Source Image do not exist in it.
_Avoid_: Image (when meaning the 3D form), letter, model, mesh

**Floor**:
The ground the Cutout stands on, where worms that miss or slide off the Cutout come to rest.
_Avoid_: Ground plane, base

**Flat View**:
The 2D front-on view of the Source Image, where the user places worms by clicking.
_Avoid_: Preview, 2D panel, side view

**Drop Point**:
The place in the Flat View that the user clicks to create a worm.
_Avoid_: Click location, spawn point

**Worm**:
A soft 3D body that falls under gravity and bends over what it lands on until it is Settled. Until then, gravity and contact are the only things that move it.
_Avoid_: Snake, noodle, tube

**Settled**:
The final state of a Worm that has come to rest. A Settled Worm never moves or changes shape again, and later Worms land on it as if it were solid.
_Avoid_: Frozen, sleeping, done

**Next Worm Settings**:
The approximate size and Grip that apply to the next Worm created. Changing them never affects existing Worms.
_Avoid_: Global settings, brush

**Grip**:
How strongly a Worm resists sliding along what it rests on.
_Avoid_: Friction, stickiness

**Composition**:
One Source Image together with its Cutout, its Worms and how they have settled.
_Avoid_: Scene, project
