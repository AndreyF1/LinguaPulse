import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import MainApp from './MainApp';
import FunnelApp from './FunnelApp';

const App: React.FC = () => {
    return (
        <BrowserRouter>
            <Routes>
                {/* Marketing funnel for ad campaigns */}
                <Route path="/welcome" element={<FunnelApp />} />
                
                {/* Main product (requires login) */}
                <Route path="/" element={<MainApp />} />
                
                {/* Catch all - redirect to home */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
};

export default App;

