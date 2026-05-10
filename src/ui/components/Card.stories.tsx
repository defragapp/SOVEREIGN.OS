import React from 'react';
import { Meta } from '@storybook/react';
import { Card } from './Card';
export default { title: 'UI/Card', component: Card } as Meta;
export const Default = () => (<div style={{ width: 360 }}><Card><h3 style={{ margin: 0 }}>Card title</h3><p style={{ marginTop: 8 }}>This is a simple card demonstrating spacing, shadow, and token usage.</p></Card></div>);