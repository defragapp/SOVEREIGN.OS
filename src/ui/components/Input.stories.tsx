import React from 'react';
import { Meta, Story } from '@storybook/react';
import { Input } from './Input';
export default { title: 'UI/Input', component: Input } as Meta;
const Template: Story<any> = (args) => <div style={{ width: 320 }}><Input {...args} /></div>;
export const Default = Template.bind({}); Default.args = { placeholder: 'Enter text' };
export const WithValue = Template.bind({}); WithValue.args = { defaultValue: 'Hello world' };
export const Disabled = Template.bind({}); Disabled.args = { placeholder: 'Disabled', disabled: true };