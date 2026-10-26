# Character source assets and attribution

Files are vendored unmodified from KhronosGroup/glTF-Sample-Assets, commit
`8f492390ddc7a2ae221a1369ef560589cf8c70fb`. SHA-256, original URLs and lengths are
recorded in [provenance.json](provenance.json), checked by preparation and tests.

- [Fox source](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/8f492390ddc7a2ae221a1369ef560589cf8c70fb/Models/Fox):
  model by PixelMannen (CC0-1.0); rigging and animation by tomkranis (CC-BY-4.0);
  conversion to glTF by AsoboStudio and scurest (CC-BY-4.0).
- [Cesium Man source](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/8f492390ddc7a2ae221a1369ef560589cf8c70fb/Models/CesiumMan):
  Cesium, 2017 (CC-BY-4.0). The Cesium trademark/logo is excluded from the copyright
  license; trademark rights remain with their owner. No endorsement is claimed.

Each model directory retains the upstream LICENSE, README and metadata verbatim.
The full copyright-license texts and Cesium mark notice are in `licenses/`.
See the originals for authorship details and applicable terms.

Preparation makes an explicit, deterministic material-free GLB derivative for
**both** benchmark implementations, and extracts the original embedded base-color
image for the unlit textured demonstration. Original BIN data, mesh attributes,
influences, inverse binds, nodes, clips, key times and interpolation remain intact.
Only material references and material/texture/image/sampler JSON tables are removed
from that derivative. Derived hashes and original import diagnostics are saved in
the prepared inventory/compatibility report and copied into measured evidence.

Fox lacks authored normals; this suite deliberately uses unlit materials.
Cesium Man's mixed texture filters currently fail Mtek's original-file profile.
These limitations are recorded, and the derivatives must not be represented as
unmodified native-PBR compatibility evidence. No source file here is overwritten
by the conversion or benchmark commands.
