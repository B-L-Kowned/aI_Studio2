import React from 'react';
import Presenters from './Presenters.jsx';
import PeoplePage from '../components/PeoplePage.jsx';

/**
 * Cast — everyone in your videos, on one page, the same shape in Content and
 * Comedy: you (what you created), the program's cast (presenters or
 * characters, made here or brought in from HeyGen), and the people you
 * invited. It was three tabbed pages that each looked different.
 */
export default function Cast() {
  return <Presenters onePage after={<PeoplePage section />} />;
}
