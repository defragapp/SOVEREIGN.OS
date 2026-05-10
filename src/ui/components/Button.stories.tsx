import React from 'react';
import { Meta, Story } from '@storybook/react';
import { Button } from './Button';

export default { title: 'UI/Button', component: Button } as Meta;
const Template: Story<any> = (args) => <Button {...args}>Button</Button>;
export const Primary = Template.bind({}); Primary.args = { variant: 'primary', size: 'md' };
export const Ghost = Template.bind({}); Ghost.args = { variant: 'ghost', size: 'md' };
export const Danger = Template.bind({}); Danger.args = { variant: 'danger', size: 'md' };