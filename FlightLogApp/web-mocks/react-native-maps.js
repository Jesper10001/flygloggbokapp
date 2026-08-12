// Web-stub för react-native-maps — native-modulen kan inte bundlas på web.
// Alla exports är no-op-komponenter så kartskärmar renderar (utan karta) i
// stället för att krascha hela web-bundlingen. Endast för web-förhandsvisning.
const React = require('react');
const { View, Text } = require('react-native');

const MapPlaceholder = (props) =>
  React.createElement(
    View,
    {
      style: [
        { alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F1E3A', minHeight: 120 },
        props.style,
      ],
    },
    React.createElement(Text, { style: { color: '#5F7FA0', fontSize: 12 } }, 'Map unavailable on web'),
  );

const Noop = () => null;

module.exports = {
  __esModule: true,
  default: MapPlaceholder,
  MapView: MapPlaceholder,
  Marker: Noop,
  Callout: Noop,
  Polygon: Noop,
  Polyline: Noop,
  Circle: Noop,
  Overlay: Noop,
  Heatmap: Noop,
  Geojson: Noop,
  UrlTile: Noop,
  LocalTile: Noop,
  WMSTile: Noop,
  AnimatedRegion: class AnimatedRegion {},
  PROVIDER_DEFAULT: 'default',
  PROVIDER_GOOGLE: 'google',
};
