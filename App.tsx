import React from 'react';
import FlightGame from './components/FlightGame';
import SegmentGallery from './components/SegmentGallery';
import ResultPreview from './components/ResultPreview';

// `?segments` opens the level-segment review page instead of the game.
const showSegments = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('segments');
const resultPreview = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('result') : null;

const App: React.FC = () => resultPreview === 'failed' || resultPreview === 'success'
  ? <ResultPreview failed={resultPreview === 'failed'} />
  : showSegments ? <SegmentGallery /> : <FlightGame />;

export default App;
